/*global require,module*/

"use strict";

class Command {
    constructor(name, async) {
        this.name = name;
        this.args = [];
        this.redirs = [];
        this.subscriptions = [];
        this.assignments = undefined;
        this.async = async;
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

    subscribe(cb) {
        this.subscriptions.push(cb);
    }

    run() {
        console.log(`running command ${this.name}`, "args", JSON.stringify(this.args), "assign", JSON.stringify(this.assignents));
        setTimeout(() => { this._notify(1); }, 100);
    }

    _notify(state) {
        this.state = state;
        for (let i = 0; i < this.subscriptions.length; ++i)
            this.subscriptions[i](state);
    }
}

module.exports = Command;
