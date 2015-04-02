#!/bin/bash
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2015, Joyent, Inc.
#

set -o xtrace
DIR=`dirname $0`
ROOT=$(cd `dirname $0`/.. && pwd)

. /lib/sdc/config.sh

load_sdc_config

export PREFIX=$npm_config_prefix
export ETC_DIR=$npm_config_etc
export SMF_DIR=$npm_config_smfdir
export VERSION=$npm_package_version
export ENABLED=true

if [[ $CONFIG_die_rabbit_die == "true" ]]; then
    export ENABLED=false
fi

subfile () {
  IN=$1
  OUT=$2
  sed -e "s#@@PREFIX@@#$PREFIX#g" \
      -e "s/@@VERSION@@/$VERSION/g" \
      -e "s#@@ROOT@@#$ROOT#g" \
      -e "s/@@ENABLED@@/$ENABLED/g" \
      $IN > $OUT
}

subfile "$ROOT/smf/method/heartbeater.in" "$ROOT/smf/method/heartbeater"
subfile "$ROOT/smf/manifests/heartbeater.xml.in" "$SMF_DIR/heartbeater.xml"
chmod +x "$ROOT/smf/method/heartbeater"
svccfg import $SMF_DIR/heartbeater.xml
