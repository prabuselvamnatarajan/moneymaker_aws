#!/bin/bash
set -e

echo "🛠️  Preparing keyfile..."
cp /etc/mongo-keyfile /data/keyfile
chmod 400 /data/keyfile
chown mongodb:mongodb /data/keyfile

if [ -f /init-signal/done ]; then
  echo "✅ Already bootstrapped, starting with auth..."
  exec mongod --config /etc/mongod.conf
fi

echo "🚀 Starting MongoDB WITHOUT auth for bootstrap..."
mongod --config /etc/mongod-bootstrap.conf --fork --logpath /tmp/mongod.log

echo "⏳ Waiting for bootstrap signal from mongo1..."
until [ -f /init-signal/done ]; do
  echo "  ...waiting for signal..."
  sleep 2
done

echo "🛑 Signal received, restarting with auth + keyfile..."
mongod --shutdown --dbpath /data/db

exec mongod --config /etc/mongod.conf