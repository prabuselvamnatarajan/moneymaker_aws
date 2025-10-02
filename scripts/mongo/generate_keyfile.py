import secrets
import base64

key = secrets.token_bytes(756)
encoded = base64.b64encode(key).decode('utf-8')

with open('rs_keyfile', 'w') as f:
    f.write(encoded)