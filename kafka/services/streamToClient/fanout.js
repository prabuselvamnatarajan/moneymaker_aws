export function fanoutRedisMessage(channelSubscriptions, sockets, channel, message) {
  const socketIds = channelSubscriptions.get(channel);
  if (!socketIds) return 0;

  let sent = 0;
  for (const id of socketIds) {
    const ws = sockets.get(id);
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(message);
      sent += 1;
    }
  }
  return sent;
}
