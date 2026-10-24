import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import https from "https";

const execFileAsync = promisify(execFile);

// Strict regex pattern for safe container ID or name validation
const SAFE_CONTAINER_ID_REGEX = /^[a-zA-Z0-9_.-]+$/;

function isKubernetes() {
  return Boolean(process.env.KUBERNETES_SERVICE_HOST);
}

/**
 * Filter helper to determine if a container belongs to the MoneyMaker / BackTest stack
 */
function isApplicationContainer(c) {
  const name = (c.Names || "").toLowerCase();
  const image = (c.Image || "").toLowerCase();
  const labels = (c.Labels || "").toLowerCase();

  return (
    name.includes("moneymaker") ||
    name.includes("backtest") ||
    name.includes("mongo") ||
    name.includes("kafka") ||
    name.includes("redis") ||
    name.includes("zookeeper") ||
    name.includes("proxy") ||
    name.includes("strategy") ||
    image.includes("moneymaker") ||
    image.includes("backtest") ||
    labels.includes("moneymaker")
  );
}

function isApplicationPod(pod) {
  const name = (pod.metadata?.name || "").toLowerCase();
  const labels = pod.metadata?.labels || {};
  const labelBlob = Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(",")
    .toLowerCase();
  const images = (pod.spec?.containers || [])
    .map((c) => (c.image || "").toLowerCase())
    .join(",");

  return (
    labels["app.kubernetes.io/part-of"] === "moneymaker" ||
    name.includes("moneymaker") ||
    name.includes("backtest") ||
    name.includes("mongo") ||
    name.includes("kafka") ||
    name.includes("redis") ||
    name.includes("zookeeper") ||
    name.includes("proxy") ||
    name.includes("strategy") ||
    images.includes("backtest") ||
    labelBlob.includes("moneymaker")
  );
}

/**
 * In-cluster Kubernetes API request (ServiceAccount token).
 */
async function k8sApiRequest(apiPath) {
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT || "443";
  const token = await fs.promises.readFile(
    "/var/run/secrets/kubernetes.io/serviceaccount/token",
    "utf8"
  );
  const ca = await fs.promises.readFile(
    "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
  );
  const namespace =
    process.env.POD_NAMESPACE ||
    (
      await fs.promises.readFile(
        "/var/run/secrets/kubernetes.io/serviceaccount/namespace",
        "utf8"
      )
    ).trim();

  const path = apiPath.includes("{namespace}")
    ? apiPath.replace("{namespace}", encodeURIComponent(namespace))
    : apiPath;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: host,
        port,
        path,
        method: "GET",
        ca,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            const err = new Error(
              `Kubernetes API ${res.statusCode}: ${body.slice(0, 500)}`
            );
            err.statusCode = res.statusCode;
            return reject(err);
          }
          try {
            resolve(JSON.parse(body || "{}"));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function handleDockerError(error, res, next) {
  if (
    error.code === 127 ||
    error.code === "ENOENT" ||
    (error.stderr && error.stderr.includes("not found"))
  ) {
    return res.status(500).json({
      message:
        "Docker CLI is not installed or accessible in the container environment. Ensure docker-cli is installed and /var/run/docker.sock is mounted.",
      error: "Docker CLI Unavailable",
    });
  }
  if (error.stderr && error.stderr.includes("permission denied")) {
    return res.status(500).json({
      message: "Permission denied accessing Docker daemon socket /var/run/docker.sock.",
      error: "Docker Socket Permission Denied",
    });
  }
  return next(error);
}

function handleK8sError(error, res, next) {
  if (error.statusCode === 403 || error.statusCode === 401) {
    return res.status(500).json({
      message:
        "Permission denied accessing the Kubernetes API. Ensure the backtest-app ServiceAccount can get/list pods and pods/log.",
      error: "Kubernetes API Permission Denied",
    });
  }
  if (error.code === "ENOENT") {
    return res.status(500).json({
      message:
        "Kubernetes ServiceAccount credentials are missing in this container.",
      error: "Kubernetes Credentials Unavailable",
    });
  }
  return next(error);
}

function podPhaseToState(pod) {
  const phase = (pod.status?.phase || "").toLowerCase();
  if (phase === "running") return "running";
  if (phase === "succeeded") return "exited";
  if (phase === "failed") return "exited";
  if (phase === "pending") return "created";
  return phase || "unknown";
}

function mapPodToContainerItem(pod) {
  const name = pod.metadata?.name || "";
  const image = (pod.spec?.containers || []).map((c) => c.image).join(",") || "N/A";
  const phase = pod.status?.phase || "Unknown";
  const ready =
    (pod.status?.containerStatuses || []).every((s) => s.ready) &&
    phase === "Running";
  return {
    id: name,
    name,
    image,
    status: ready ? `Up (${phase})` : phase,
    ports: "N/A",
    state: podPhaseToState(pod),
    createdAt: pod.metadata?.creationTimestamp || "",
  };
}

async function getContainersFromKubernetes(req, res, next) {
  try {
    const { scope } = req.query;
    const data = await k8sApiRequest(
      "/api/v1/namespaces/{namespace}/pods"
    );
    const pods = data.items || [];
    const items = pods
      .filter((p) => scope === "all" || isApplicationPod(p))
      .map(mapPodToContainerItem);

    res.status(200).json({
      message: "Containers retrieved successfully",
      items,
    });
  } catch (error) {
    return handleK8sError(error, res, next);
  }
}

async function getContainerLogsFromKubernetes(req, res, next) {
  try {
    const { containerId } = req.params;
    const { tail = "200", timestamps = "true" } = req.query;

    if (!containerId || !SAFE_CONTAINER_ID_REGEX.test(containerId)) {
      return res
        .status(400)
        .json({ message: "Invalid or missing Container ID parameter" });
    }

    const sanitizedTail = Math.min(
      Math.max(1, parseInt(tail, 10) || 200),
      5000
    );

    let pod;
    try {
      pod = await k8sApiRequest(
        `/api/v1/namespaces/{namespace}/pods/${encodeURIComponent(containerId)}`
      );
    } catch (err) {
      if (err.statusCode === 404) {
        return res.status(404).json({ message: "Container not found" });
      }
      throw err;
    }

    const qs = new URLSearchParams({
      tailLines: String(sanitizedTail),
      timestamps: timestamps === "true" ? "true" : "false",
    });
    const logPath = `/api/v1/namespaces/{namespace}/pods/${encodeURIComponent(
      containerId
    )}/log?${qs.toString()}`;

    // Log endpoint returns plain text, not JSON — fetch via raw request
    const host = process.env.KUBERNETES_SERVICE_HOST;
    const port = process.env.KUBERNETES_SERVICE_PORT || "443";
    const token = await fs.promises.readFile(
      "/var/run/secrets/kubernetes.io/serviceaccount/token",
      "utf8"
    );
    const ca = await fs.promises.readFile(
      "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
    );
    const namespace =
      process.env.POD_NAMESPACE ||
      (
        await fs.promises.readFile(
          "/var/run/secrets/kubernetes.io/serviceaccount/namespace",
          "utf8"
        )
      ).trim();
    const resolvedPath = logPath.replace(
      "{namespace}",
      encodeURIComponent(namespace)
    );

    const rawOutput = await new Promise((resolve, reject) => {
      const reqHttps = https.request(
        {
          hostname: host,
          port,
          path: resolvedPath,
          method: "GET",
          ca,
          headers: { Authorization: `Bearer ${token}` },
        },
        (resHttps) => {
          let body = "";
          resHttps.on("data", (c) => {
            body += c;
          });
          resHttps.on("end", () => {
            if (resHttps.statusCode && resHttps.statusCode >= 400) {
              const err = new Error(
                `Kubernetes log API ${resHttps.statusCode}: ${body.slice(0, 500)}`
              );
              err.statusCode = resHttps.statusCode;
              return reject(err);
            }
            resolve(body);
          });
        }
      );
      reqHttps.on("error", reject);
      reqHttps.end();
    });

    const logLines = (rawOutput || "")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const match = line.match(
          /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(.*)$/
        );
        if (match) {
          return {
            timestamp: match[1],
            message: match[2],
            level: detectLogLevel(match[2]),
          };
        }
        return {
          timestamp: new Date().toISOString(),
          message: line,
          level: detectLogLevel(line),
        };
      });

    res.status(200).json({
      message: "Logs retrieved successfully",
      containerId,
      containerName: pod.metadata?.name || containerId,
      logs: logLines,
    });
  } catch (error) {
    return handleK8sError(error, res, next);
  }
}

// Get list of running containers for the application
export const getContainers = async (req, res, next) => {
  if (isKubernetes()) {
    return getContainersFromKubernetes(req, res, next);
  }

  try {
    const { all, scope } = req.query;
    const args = ["ps", "--format", "{{json .}}"];

    if (all === "true") {
      args.push("-a");
    }

    const { stdout } = await execFileAsync("docker", args);

    const lines = stdout.trim().split("\n").filter((line) => line.trim());
    const containers = lines
      .map((line) => {
        try {
          const c = JSON.parse(line);
          const name = (c.Names || "").replace(/^\//, "");

          if (scope === "all" || isApplicationContainer(c)) {
            return {
              id: c.ID,
              name: name,
              image: c.Image,
              status: c.Status,
              ports: c.Ports || "N/A",
              state:
                c.State ||
                (c.Status.toLowerCase().includes("up") ? "running" : "exited"),
              createdAt: c.CreatedAt || "",
            };
          }
          return null;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    res.status(200).json({
      message: "Containers retrieved successfully",
      items: containers,
    });
  } catch (error) {
    handleDockerError(error, res, next);
  }
};

// Get logs for a specific container
export const getContainerLogs = async (req, res, next) => {
  if (isKubernetes()) {
    return getContainerLogsFromKubernetes(req, res, next);
  }

  try {
    const { containerId } = req.params;
    const { tail = "200", timestamps = "true" } = req.query;

    if (!containerId || !SAFE_CONTAINER_ID_REGEX.test(containerId)) {
      return res
        .status(400)
        .json({ message: "Invalid or missing Container ID parameter" });
    }

    const sanitizedTail = Math.min(
      Math.max(1, parseInt(tail, 10) || 200),
      5000
    );

    let containerInfo = null;
    try {
      const { stdout: inspectOut } = await execFileAsync("docker", [
        "inspect",
        containerId,
      ]);
      const inspectData = JSON.parse(inspectOut);
      if (!inspectData || inspectData.length === 0) {
        return res.status(404).json({ message: "Container not found" });
      }
      containerInfo = inspectData[0];
    } catch (inspectErr) {
      if (inspectErr.code === 127 || inspectErr.code === "ENOENT") {
        return handleDockerError(inspectErr, res, next);
      }
      return res
        .status(404)
        .json({ message: "Container not found or inaccessible" });
    }

    const args = ["logs", "--tail", String(sanitizedTail)];
    if (timestamps === "true") {
      args.push("--timestamps");
    }
    args.push(containerId);

    let rawOutput = "";
    try {
      const { stdout, stderr } = await execFileAsync("docker", args, {
        maxBuffer: 15 * 1024 * 1024,
      });
      rawOutput = (stdout || "") + (stderr || "");
    } catch (cmdErr) {
      if (cmdErr.stdout || cmdErr.stderr) {
        rawOutput = (cmdErr.stdout || "") + (cmdErr.stderr || "");
      } else {
        return handleDockerError(cmdErr, res, next);
      }
    }

    const logLines = rawOutput
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const match = line.match(
          /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(.*)$/
        );
        if (match) {
          return {
            timestamp: match[1],
            message: match[2],
            level: detectLogLevel(match[2]),
          };
        }
        return {
          timestamp: new Date().toISOString(),
          message: line,
          level: detectLogLevel(line),
        };
      });

    res.status(200).json({
      message: "Logs retrieved successfully",
      containerId,
      containerName: (containerInfo.Name || "").replace(/^\//, ""),
      logs: logLines,
    });
  } catch (error) {
    handleDockerError(error, res, next);
  }
};

function detectLogLevel(message) {
  const lowerMsg = message.toLowerCase();
  if (
    lowerMsg.includes("error") ||
    lowerMsg.includes("fatal") ||
    lowerMsg.includes("critical") ||
    lowerMsg.includes("exception") ||
    lowerMsg.includes("500 internal") ||
    lowerMsg.includes("502 bad") ||
    lowerMsg.includes("503 service")
  ) {
    return "error";
  }
  if (
    lowerMsg.includes("warn") ||
    lowerMsg.includes("warning") ||
    lowerMsg.includes("404 ") ||
    lowerMsg.includes("401 ") ||
    lowerMsg.includes("403 ")
  ) {
    return "warn";
  }
  if (lowerMsg.includes("debug") || lowerMsg.includes("trace")) {
    return "debug";
  }
  if (
    lowerMsg.includes("info") ||
    lowerMsg.includes("http") ||
    lowerMsg.includes("listening")
  ) {
    return "info";
  }
  return "log";
}
