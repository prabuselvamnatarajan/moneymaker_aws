import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Strict regex pattern for safe container ID or name validation
const SAFE_CONTAINER_ID_REGEX = /^[a-zA-Z0-9_.-]+$/;

/**
 * Filter helper to determine if a container belongs to the MoneyMaker / BackTest stack
 */
function isApplicationContainer(c) {
  const name = (c.Names || '').toLowerCase();
  const image = (c.Image || '').toLowerCase();
  const labels = (c.Labels || '').toLowerCase();

  return (
    name.includes('moneymaker') ||
    name.includes('backtest') ||
    name.includes('mongo') ||
    name.includes('kafka') ||
    name.includes('redis') ||
    name.includes('zookeeper') ||
    name.includes('proxy') ||
    name.includes('strategy') ||
    image.includes('moneymaker') ||
    image.includes('backtest') ||
    labels.includes('moneymaker')
  );
}

/**
 * Handle Docker CLI execution errors gracefully
 */
function handleDockerError(error, res, next) {
  if (error.code === 127 || error.code === 'ENOENT' || (error.stderr && error.stderr.includes('not found'))) {
    return res.status(500).json({
      message: "Docker CLI is not installed or accessible in the container environment. Ensure docker-cli is installed and /var/run/docker.sock is mounted.",
      error: "Docker CLI Unavailable"
    });
  }
  if (error.stderr && error.stderr.includes('permission denied')) {
    return res.status(500).json({
      message: "Permission denied accessing Docker daemon socket /var/run/docker.sock.",
      error: "Docker Socket Permission Denied"
    });
  }
  return next(error);
}

// Get list of running containers for the application
export const getContainers = async (req, res, next) => {
  try {
    const { all, scope } = req.query;
    const args = ['ps', '--format', '{{json .}}'];
    
    if (all === 'true') {
      args.push('-a');
    }

    const { stdout } = await execFileAsync('docker', args);
    
    const lines = stdout.trim().split('\n').filter(line => line.trim());
    const containers = lines.map(line => {
      try {
        const c = JSON.parse(line);
        const name = (c.Names || '').replace(/^\//, '');

        // Return container if scope is 'all' or if it matches application stack
        if (scope === 'all' || isApplicationContainer(c)) {
          return {
            id: c.ID,
            name: name,
            image: c.Image,
            status: c.Status,
            ports: c.Ports || 'N/A',
            state: c.State || (c.Status.toLowerCase().includes('up') ? 'running' : 'exited'),
            createdAt: c.CreatedAt || ''
          };
        }
        return null;
      } catch {
        return null;
      }
    }).filter(Boolean);
    
    res.status(200).json({
      message: "Containers retrieved successfully",
      items: containers
    });
  } catch (error) {
    handleDockerError(error, res, next);
  }
};

// Get logs for a specific container
export const getContainerLogs = async (req, res, next) => {
  try {
    const { containerId } = req.params;
    const { tail = '200', timestamps = 'true' } = req.query;
    
    if (!containerId || !SAFE_CONTAINER_ID_REGEX.test(containerId)) {
      return res.status(400).json({ message: "Invalid or missing Container ID parameter" });
    }
    
    const sanitizedTail = Math.min(Math.max(1, parseInt(tail, 10) || 200), 5000);
    
    // Validate container exists and inspect details safely
    let containerInfo = null;
    try {
      const { stdout: inspectOut } = await execFileAsync('docker', ['inspect', containerId]);
      const inspectData = JSON.parse(inspectOut);
      if (!inspectData || inspectData.length === 0) {
        return res.status(404).json({ message: "Container not found" });
      }
      containerInfo = inspectData[0];
    } catch (inspectErr) {
      if (inspectErr.code === 127 || inspectErr.code === 'ENOENT') {
        return handleDockerError(inspectErr, res, next);
      }
      return res.status(404).json({ message: "Container not found or inaccessible" });
    }
    
    // Build parameterized docker logs arguments
    const args = ['logs', '--tail', String(sanitizedTail)];
    if (timestamps === 'true') {
      args.push('--timestamps');
    }
    args.push(containerId);
    
    let rawOutput = '';
    try {
      const { stdout, stderr } = await execFileAsync('docker', args, {
        maxBuffer: 15 * 1024 * 1024 // 15MB buffer limit for long outputs
      });
      rawOutput = (stdout || '') + (stderr || '');
    } catch (cmdErr) {
      // docker logs outputs to stderr when writing stderr streams
      if (cmdErr.stdout || cmdErr.stderr) {
        rawOutput = (cmdErr.stdout || '') + (cmdErr.stderr || '');
      } else {
        return handleDockerError(cmdErr, res, next);
      }
    }
    
    // Parse logs into structured lines with timestamp & log level detection
    const logLines = rawOutput
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        // Docker log timestamp pattern ISO: YYYY-MM-DDTHH:mm:ss.SSSSSSSSSZ
        const match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(.*)$/);
        if (match) {
          return {
            timestamp: match[1],
            message: match[2],
            level: detectLogLevel(match[2])
          };
        }
        return {
          timestamp: new Date().toISOString(),
          message: line,
          level: detectLogLevel(line)
        };
      });
    
    res.status(200).json({
      message: "Logs retrieved successfully",
      containerId,
      containerName: (containerInfo.Name || '').replace(/^\//, ''),
      logs: logLines
    });
  } catch (error) {
    handleDockerError(error, res, next);
  }
};

// Helper to detect log level from log text
function detectLogLevel(message) {
  const lowerMsg = message.toLowerCase();
  if (
    lowerMsg.includes('error') ||
    lowerMsg.includes('fatal') ||
    lowerMsg.includes('critical') ||
    lowerMsg.includes('exception') ||
    lowerMsg.includes('500 internal') ||
    lowerMsg.includes('502 bad') ||
    lowerMsg.includes('503 service')
  ) {
    return 'error';
  }
  if (
    lowerMsg.includes('warn') ||
    lowerMsg.includes('warning') ||
    lowerMsg.includes('404 ') ||
    lowerMsg.includes('401 ') ||
    lowerMsg.includes('403 ')
  ) {
    return 'warn';
  }
  if (lowerMsg.includes('debug') || lowerMsg.includes('trace')) {
    return 'debug';
  }
  if (lowerMsg.includes('info') || lowerMsg.includes('http') || lowerMsg.includes('listening')) {
    return 'info';
  }
  return 'log';
}
