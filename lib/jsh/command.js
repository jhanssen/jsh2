/*global require,module*/

"use strict";

class Command {
    constructor(name) {
        this.name = name;
        this.args = [];
        this.redirs = [];
        this.assignments = undefined;
    }

    addArgument(arg) {
        this.args.push(arg);
    }

    redirect(redir) {
        this.redirs.push(redir);
    }

    setAssignments(assignents) {
        this.assignents = assignents;
    }

    run() {
        console.log(`running command ${this.name}`, "args", JSON.stringify(this.args), "assign", JSON.stringify(this.assignents));
    }
}

module.exports = Command;
