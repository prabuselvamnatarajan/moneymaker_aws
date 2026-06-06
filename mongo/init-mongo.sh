#!/bin/bash
echo "🛠️  Preparing keyfile..."
cp /etc/mongo-keyfile /data/keyfile
chmod 400 /data/keyfile
chown mongodb:mongodb /data/keyfile

echo "🚀 Starting MongoDB..."
exec mongod --config /etc/mongod.conf --keyFile /data/keyfile