#!/bin/bash
echo "🛠️  Preparing keyfile..."
cp /etc/mongo-keyfile /data/keyfile
chmod 400 /data/keyfile
chown mongodb:mongodb /data/keyfile

echo "🚀 Starting MongoDB in background (no auth) to bootstrap..."
mongod --config /etc/mongod.conf --keyFile /data/keyfile --fork --logpath /tmp/mongod.log

echo "⏳ Waiting for mongod to be ready..."
until mongosh --quiet --eval "db.adminCommand('ping')" &>/dev/null; do
  sleep 1
done

echo "👤 Creating root user..."
mongosh admin --eval "
  db.createUser({
    user: 'root',
    pwd: 'example',
    roles: [ { role: 'root', db: 'admin' } ]
  });
"

echo "🔗 Initiating replica set..."
mongosh admin -u root -p example --eval "
  rs.initiate({
    _id: 'rs0',
    members: [
      { _id: 0, host: 'mongo1:27017' },
      { _id: 1, host: 'mongo2:27017' },
      { _id: 2, host: 'mongo3:27017' }
    ]
  });
"

echo "🛑 Stopping background mongod..."
mongod --shutdown --dbpath /data/db

echo "🚀 Restarting MongoDB in foreground (with auth)..."
exec mongod --config /etc/mongod.conf --keyFile /data/keyfile