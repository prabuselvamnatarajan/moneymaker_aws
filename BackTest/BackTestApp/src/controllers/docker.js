import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Get list of running containers for the application
export const getContainers = async (req, res, next) => {
  try {
    // Filter containers by label or name pattern related to backtest application
    const { all } = req.query;
    const filter = all === 'true' ? '' : '--filter "status=running"';
    
    const { stdout } = await execAsync(
      `docker ps --format "{{json .}}" ${filter}`
    );
    
    const lines = stdout.trim().split('\n').filter(line => line.trim());
    const containers = lines.map(line => {
      try {
        const c = JSON.parse(line);
        // Only include containers related to backtest application
        if (c.Names.includes('backtest') || c.Names.includes('backtest-')) {
          return {
            id: c.ID,
            name: c.Names.replace(/^\//, ''),
            image: c.Image,
            status: c.Status,
            ports: c.Ports,
            state: c.State
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
    next(error);
  }
};

// Get logs for a specific container
export const getContainerLogs = async (req, res, next) => {
  try {
    const { containerId } = req.params;
    const { tail = '100', follow = 'false', timestamps = 'true' } = req.query;
    
    if (!containerId) {
      return res.status(400).json({ message: "Container ID is required" });
    }
    
    // Validate container exists and belongs to our application
    try {
      const { stdout: inspectOut } = await execAsync(
        `docker inspect ${containerId}`
      );
      const inspectData = JSON.parse(inspectOut);
      if (!inspectData || inspectData.length === 0) {
        return res.status(404).json({ message: "Container not found" });
      }
      
      const containerName = inspectData[0].Name.replace(/^\//, '');
      if (!containerName.includes('backtest')) {
        return res.status(403).json({ message: "Access denied: Container not part of application" });
      }
    } catch (inspectErr) {
      return res.status(404).json({ message: "Container not found or inaccessible" });
    }
    
    // Build docker logs command
    let cmd = `docker logs --tail ${tail}`;
    if (timestamps === 'true') {
      cmd += ' --timestamps';
    }
    cmd += ` ${containerId} 2>&1`;
    
    const { stdout } = await execAsync(cmd);
    
    // Parse logs with timestamps
    const logLines = stdout.split('\n').filter(line => line.trim()).map(line => {
      // Docker log format: TIMESTAMP MESSAGE
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
      logs: logLines
    });
  } catch (error) {
    next(error);
  }
};

// Helper to detect log level from message
function detectLogLevel(message) {
  const lowerMsg = message.toLowerCase();
  if (lowerMsg.includes('error') || lowerMsg.includes('fatal') || lowerMsg.includes('critical')) {
    return 'error';
  }
  if (lowerMsg.includes('warn') || lowerMsg.includes('warning')) {
    return 'warn';
  }
  if (lowerMsg.includes('debug')) {
    return 'debug';
  }
  if (lowerMsg.includes('info')) {
    return 'info';
  }
  return 'log';
}
