<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright (c) 2014, Joyent, Inc.
-->

# Heartbeater Agent

Repository: <git@github.com:joyent/sdc-heartbeater.git>
Browsing: <https://mo.joyent.com/heartbeater>
Who: Orlando Vazquez
Docs: <https://mo.joyent.com/docs/heartbeater>
Tickets/bugs: <https://devhub.joyent.com/jira/browse/AGENTS>


# Overview

The Smart Datacenter Hearbeater Agent (or heartbeater, for short) is a
process which runs on all SDC nodes and periodically emits to AMQP a object
containing usage and status information.


Start with the guidelines: <https://mo.joyent.com/docs/eng>


# Repository

    deps/           Git submodules and/or commited 3rd-party deps should go
                    here. See "node_modules/" for node.js deps.
    docs/           Project docs (restdown)
    lib/            Source files.
    node_modules/   Node.js deps, either populated at build time or commited.
                    See Managing Dependencies.
    pkg/            Package lifecycle scripts
    smf/manifests   SMF manifests
    smf/methods     SMF method scripts
    test/           Test suite (using node-tap)
    tools/          Miscellaneous dev/upgrade/deployment tools and data.
    Makefile
    package.json    npm module info (holds the project version)
    README.md


# Development

To run the boilerplate API server:

    git clone git@github.com:joyent/sdc-heartbeater-agent.git
    cd sdc-heartbeater-agent
    git submodule update --init
    make all
    node bin/heartbeater.js

To update the guidelines, edit "docs/index.restdown" and run `make docs`
to update "docs/index.html".

Before commiting/pushing run `make prepush` and, if possible, get a code
review.
