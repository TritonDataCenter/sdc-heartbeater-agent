<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2014, Joyent, Inc.
-->

# SDC Heartbeater Agent

This repository is part of the SmartDataCenter (SDC) project. For
contribution guidelines, issues, and general documentation, visit the
[main SDC project](http://github.com/joyent/sdc).


## Overview

SDC Heartbeater Agent is the resources status service running on
all compute nodes. It periodically emits to AMQP an object containing
current usage information on cores, memory and disk for the instances and images
of a server on which the service is run.


## Development

    git clone git@github.com:joyent/sdc-heartbeater-agent.git
    cd sdc-heartbeater-agent
    git submodule update --init


## License

SDC is licensed under the
[Mozilla Public License version 2.0](http://mozilla.org/MPL/2.0/).
See the file LICENSE.
