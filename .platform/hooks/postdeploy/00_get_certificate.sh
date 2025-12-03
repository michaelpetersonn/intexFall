#!/usr/bin/env bash
# .platform/hooks/postdeploy/00_get_certificate.sh

sudo certbot -n \
  --nginx \
  --agree-tos \
  --email mhawkin9@byu.edu \
  -d ellarises2-15.is404.net \
  -d intexfall2-15.us-east-2.elasticbeanstalk.com
