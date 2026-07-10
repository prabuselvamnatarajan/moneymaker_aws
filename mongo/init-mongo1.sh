#!/bin/bash
set -e

echo "🛠️  Preparing keyfile..."
cp /etc/mongo-keyfile /data/keyfile
chmod 400 /data/keyfile
chown mongodb:mongodb /data/keyfile

# Skip bootstrap if already done
if [ -f /init-signal/done ]; then
  echo "✅ Already bootstrapped, starting with auth..."
  exec mongod --config /etc/mongod.conf
fi

echo "🚀 Starting MongoDB WITHOUT auth for bootstrap..."
mongod --config /etc/mongod-bootstrap.conf --fork --logpath /tmp/mongod.log

echo "⏳ Waiting for mongod to be ready..."
until mongosh --quiet --eval "db.adminCommand('ping')" &>/dev/null; do
  sleep 1
done

echo "⏳ Waiting for mongo2 to be reachable..."
until mongosh --host mongo2 --port 27017 --quiet --eval "db.adminCommand('ping')" &>/dev/null; do
  echo "  ...mongo2 not ready, waiting..."
  sleep 2
done

echo "⏳ Waiting for mongo3 to be reachable..."
until mongosh --host mongo3 --port 27017 --quiet --eval "db.adminCommand('ping')" &>/dev/null; do
  echo "  ...mongo3 not ready, waiting..."
  sleep 2
done

echo "🔗 Initiating replica set..."
until mongosh admin --eval "
  rs.initiate({
    _id: 'rs0',
    members: [
      { _id: 0, host: 'mongo1:27017' },
      { _id: 1, host: 'mongo2:27017' },
      { _id: 2, host: 'mongo3:27017' }
    ]
  });
"; do
  echo "  ...rs.initiate() failed, retrying..."
  sleep 2
done

echo "⏳ Waiting for PRIMARY election..."
until mongosh --quiet --eval "db.hello().isWritablePrimary" 2>/dev/null | grep -q "true"; do
  echo "  ...not primary yet, waiting..."
  sleep 2
done

echo "👤 Creating root user..."
mongosh admin --eval "
  db.createUser({
    user: 'root',
    pwd: 'example',
    roles: [ { role: 'root', db: 'admin' } ]
  });
"

echo "🛑 Stopping bootstrap mongod..."
mongod --shutdown --dbpath /data/db || true

echo "🚦 Writing signal for mongo2/mongo3..."
touch /init-signal/done

echo "✅ Bootstrap complete. Restarting with auth + keyfile..."
exec mongod --config /etc/mongod.conf