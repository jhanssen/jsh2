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
        if (arg instanceof Array) {
            this.args = this.args.concat(arg);
        } else {
            this.args.push(arg + "");
        }
    }

    addRedirect(redir) {
        this.redirs.push(redir);
    }

    setAssignments(assignents) {
        this.assigns = assignents;
    }
}

module.exports = Command;
