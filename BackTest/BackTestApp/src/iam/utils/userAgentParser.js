export function parseUserAgent(ua, ip) {
  let browser = "Unknown Browser";
  let os = "Unknown OS";
  let device = "Desktop PC";

  if (!ua) {
    return { browser, os, device, ip: ip || "127.0.0.1", location: "Unknown Location" };
  }

  // Parse OS
  if (ua.includes("Windows")) {
    os = "Windows";
  } else if (ua.includes("Mac OS X") || ua.includes("Macintosh")) {
    os = (ua.includes("iPhone") || ua.includes("iPad")) ? "iOS" : "macOS";
  } else if (ua.includes("Linux")) {
    os = "Linux";
  } else if (ua.includes("Android")) {
    os = "Android";
  }

  // Parse Browser
  if (ua.includes("Chrome") && !ua.includes("Chromium") && !ua.includes("Edg")) {
    browser = "Chrome";
  } else if (ua.includes("Safari") && !ua.includes("Chrome")) {
    browser = "Safari";
  } else if (ua.includes("Firefox")) {
    browser = "Firefox";
  } else if (ua.includes("Edg")) {
    browser = "Edge";
  } else if (ua.includes("PostmanRuntime") || ua.includes("curl") || ua.includes("node-fetch") || ua.includes("axios")) {
    browser = "API Client";
  }

  // Parse Device / simple model
  if (ua.includes("iPhone")) {
    device = "iPhone";
  } else if (ua.includes("iPad")) {
    device = "iPad";
  } else if (ua.includes("Android")) {
    device = "Android Device";
  } else if (ua.includes("Macintosh")) {
    device = "MacBook / iMac";
  } else {
    device = "Desktop PC";
  }

  // Simple Location mapping
  let location = "Unknown Location";
  const cleanIp = String(ip).replace(/^::ffff:/, "");
  if (cleanIp === "127.0.0.1" || cleanIp === "::1" || cleanIp === "localhost") {
    location = "Localhost";
  } else {
    location = "Remote Access";
  }

  return { browser, os, device, ip: cleanIp || "127.0.0.1", location };
}
