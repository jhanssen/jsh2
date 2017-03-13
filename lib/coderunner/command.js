/*global require,module,process*/

"use strict";

class Command {
    constructor(name, async) {
        this.name = name;
        this.args = [];
        this.redirs = [];
        this.assigns = undefined;
        this.async = async;
    }

    addArgument(arg) {
        this.args.push(arg + "");
    }

    addRedirect(redir) {
        this.redirs.push(redir);
    }

    setAssignments(assignents) {
        this.assigns = assignents;
    }
}

module.exports = Command;
