#!/usr/bin/env bash
# .platform/hooks/postdeploy/00_get_certificate.sh

# Exit successfully if anything goes wrong in here
set +e

# If certbot isn't installed, don't fail the deploy
if ! command -v certbot >/dev/null 2>&1; then
  echo "certbot not found, skipping certificate step"
  exit 0
fi

# Only try to get a cert if we DON'T already have one
if ! sudo certbot certificates | grep -q "ellarises2-15.is404.net"; then
  echo "Requesting new certificate for ellarises2-15.is404.net and intexfall2-15.us-east-2.elasticbeanstalk.com..."
  sudo certbot -n \
    --nginx \
    --agree-tos \
    --email mhawkin9@byu.edu \
    -d ellarises2-15.is404.net \
    -d intexfall2-15.us-east-2.elasticbeanstalk.com || \
    echo "Certbot failed, but not blocking deployment."
else
  echo "Certificate already exists, skipping certbot request."
fi

exit 0
