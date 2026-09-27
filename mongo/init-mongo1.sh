#!/bin/bash
set -e

echo "Preparing keyfile..."
cp /etc/mongo-keyfile /data/keyfile
chmod 400 /data/keyfile
chown mongodb:mongodb /data/keyfile

if [ -f /init-signal/done ]; then
  echo "Already bootstrapped, starting with auth..."
  exec mongod --config /etc/mongod.conf
fi

echo "Starting MongoDB WITHOUT auth for bootstrap..."
mongod --config /etc/mongod-bootstrap.conf --fork --logpath /tmp/mongod.log

echo "Waiting for mongod to be ready..."
until mongosh --quiet --eval "db.adminCommand('ping')" &>/dev/null; do
  sleep 1
done

echo "Waiting for mongo2 to be reachable..."
until mongosh --host mongo2 --port 27017 --quiet --eval "db.adminCommand('ping')" &>/dev/null; do
  echo "  ...mongo2 not ready, waiting..."
  sleep 2
done

echo "Waiting for mongo3 to be reachable..."
until mongosh --host mongo3 --port 27017 --quiet --eval "db.adminCommand('ping')" &>/dev/null; do
  echo "  ...mongo3 not ready, waiting..."
  sleep 2
done

# Bitnami-inspired: primary-only initiate, treat already-initialized as repairable
echo "Bootstrapping replica set..."
mongosh --quiet --eval '
  function forceDesiredConfig() {
    var cfg = {
      _id: "rs0",
      version: 1,
      members: [
        { _id: 0, host: "mongo1:27017", priority: 2 },
        { _id: 1, host: "mongo2:27017", priority: 1 },
        { _id: 2, host: "mongo3:27017", priority: 1 }
      ]
    };
    try {
      var cur = rs.conf();
      cfg.version = (cur.version || 1) + 1;
    } catch (e) {}
    return rs.reconfig(cfg, { force: true });
  }

  try {
    rs.initiate({
      _id: "rs0",
      members: [ { _id: 0, host: "mongo1:27017", priority: 2 } ]
    });
    print("rs.initiate(primary-only) ok");
  } catch (e) {
    if (String(e).indexOf("already initialized") >= 0 || (e.code === 23)) {
      print("Replica set already initialized — repairing config if needed");
      forceDesiredConfig();
    } else {
      throw e;
    }
  }

  var primary = false;
  for (var i = 0; i < 90; i++) {
    try {
      var h = db.hello();
      if (h.isWritablePrimary || h.primary) { primary = true; break; }
    } catch (e) {}
    sleep(2000);
  }
  if (!primary) {
    forceDesiredConfig();
    sleep(5000);
  }

  for (var j = 0; j < 60; j++) {
    try { if (db.hello().isWritablePrimary) break; } catch (e) {}
    sleep(2000);
  }

  function ensureMember(host) {
    var st = rs.status();
    var found = false;
    st.members.forEach(function(m) { if (m.name === host) found = true; });
    if (!found) { print("rs.add(" + host + ")"); rs.add(host); }
    else { print(host + " already a member"); }
  }

  if (db.hello().isWritablePrimary) {
    ensureMember("mongo2:27017");
    ensureMember("mongo3:27017");
  } else {
    forceDesiredConfig();
  }

  printjson(rs.status().members.map(function(m) { return { n: m.name, s: m.stateStr }; }));
'

echo "Creating root user..."
mongosh admin --quiet --eval '
  try {
    db.createUser({
      user: "root",
      pwd: "example",
      roles: [ { role: "root", db: "admin" } ]
    });
    print("root created");
  } catch (e) {
    print("createUser skipped:", e.codeName || e);
  }
'

echo "Stopping bootstrap mongod..."
mongod --shutdown --dbpath /data/db || true
sleep 2

echo "Writing signal for mongo2/mongo3..."
touch /init-signal/done

echo "Bootstrap complete. Restarting with auth + keyfile..."
exec mongod --config /etc/mongod.conf
