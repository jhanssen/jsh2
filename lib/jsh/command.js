/*global require,module,process*/

"use strict";

const native = require("native-jsh");
const readline = require("native-readline");
const Job = native.Job;

class Command {
    constructor(name, async) {
        this.name = name;
        this.args = [];
        this.redirs = [];
        this.subscriptions = [];
        this.assignments = undefined;
        this.async = async;
        this.state = undefined;
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
        if (this.state !== undefined) {
            process.nextTick(() => {
                cb(this.state);
            });
        }
        this.subscriptions.push(cb);
    }

    run() {
        console.log(`running command ${this.name}`, "args", JSON.stringify(this.args), "assign", JSON.stringify(this.assignents));
        // setTimeout(() => { this._notify(1); }, 100);
        this.job = new Job();
        this.job.add({ path: this.name, args: this.args, environ: this.assignents });
        this.job.on("stateChanged", (state) => {
            if (state == Job.Terminated) {
                readline.resume(() => {
                    this._notify(state);
                });
            }
        });
        this.job.on("stdout", (buf) => {
            readline.log(buf.toString("utf8"));
        });
        this.job.on("stderr", (buf) => {
            readline.error(buf.toString("utf8"));
        });
        readline.pause(() => {
            this.job.start();
        });
    }

    _notify(state) {
        this.state = state;
        for (let i = 0; i < this.subscriptions.length; ++i)
            this.subscriptions[i](state);
    }
}

module.exports = Command;
