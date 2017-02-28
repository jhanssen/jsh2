/*global require,module,process*/

"use strict";

// class Commands {
//     constructor() {
//         this.commands = [];
//     }

//     push(cmds) {
//         this.commands.push(cmds);
//     }

//     add(cmd) {
//         this.commands[this.commands.length - 1].add(cmd);
//     }

//     pop() {
//         this.commands[this.commands.length - 1].run();
//         this.commands.pop();
//     }

//     subscribe(mode, cb) {
//         this.commands[this.commands.length - 1].subscribe(mode, cb);
//     }
// }

const native = require("native-jsh");
const readline = require("native-readline");
const Job = native.Job;

class Assignments {
    constructor() {
        this.assignments = [];
    }

    push(assignment) {
        this.assignments.push(assignment);
    }

    pop(assignment) {
        this.assignments.pop();
    }

    clone() {
        // copy the objects
        let dup = (obj) => {
            let out = {};
            for (let k in obj) {
                out[k] = obj[k];
            }
            return out;
        };

        let out = [];
        for (let i = 0; i < this.assignments.length; ++i) {
            out.push(dup(this.assignments[i]));
        }
        return out;
    }
}

class CommandBase {
    constructor() {
        this.commands = [];
        this.subscriptions = [];
        this.childCommands = new Set();
        this.status = undefined;
        this.key = 0;
    }

    add(cmd) {
        this.commands.push(cmd);
    }

    addChildCommands(cmd) {
        this.childCommands.add(cmd);
        cmd.subscribe((status) => {
            if (this.status === undefined)
                this.status = status;
            this.childCommands.delete(cmd);
            if (!this.childCommands.size)
                this._notify();
        });
    }

    subscribe(cb) {
        let k = this.key++;
        this.subscriptions.push({ k: k, cb: cb });
        if (this.status !== undefined) {
            process.nextTick(() => {
                cb(this.status);
            });
        }
        return k;
    }

    unsubscribe(key) {
        let subs = this.subscriptions;
        for (let i = 0; i < subs.length; ++i) {
            if (subs[i].k == key) {
                subs.splice(i, 1);
                return true;
            }
        }
        return false;
    }

    _notify() {
        if (this.commands.length || this.childCommands.size)
            return;
        let subs = this.subscriptions;
        for (let i = 0; i < subs.length; ++i)
            subs[i].cb(this.status);
    }
}

class CommandRunner extends CommandBase {
    run() {
        let cmds = this.commands.slice();
        let len = this.commands.length;
        let runner = function*(that) {
            for (let i = 0; i < len; ++i) {
                let cmd = cmds[i];
                let job = new Job();
                job.add({ path: cmd.name, args: cmd.args, environ: cmd.assignments });
                readline.pause(() => {
                    job.start();
                });
                if (!cmds[i].async) {
                    // wait for this command to complete
                    yield { job: job, idx: i };
                }
            }
        };
        let r = runner(this);
        let next = () => {
            let n = r.next();
            if (!n.done) {
                n.value.job.on("stateChanged", (state, status) => {
                    if (state == Job.Terminated) {
                        // we're really only interested in the status of the final command
                        native.restore();
                        readline.resume(() => {
                            if (n.idx == len - 1) {
                                this.status = status;
                                this._notify();
                            }
                            next();
                        });
                    }
                });
            }
        };
        next();
    }
};

class CommandPipeline extends CommandBase {
    run() {
        let cmds = this.commands.slice();
        let len = this.commands.length;
        let job = new Job();
        for (let i = 0; i < len; ++i) {
            let cmd = cmds[i];
            job.add({ path: cmd.name, args: cmd.args, environ: cmd.assignments });
        }
        job.on("stateChanged", (state) => {
            if (state == Job.Terminated) {
                native.restore();
                readline.resume(() => {
                    this._notify(state);
                });
            }
        });
        readline.pause(() => {
            job.start();
        });
    }
};

module.exports = {
    /*Commands: Commands,*/
    Assignments: Assignments,
    CommandRunner: CommandRunner,
    CommandPipeline: CommandPipeline
};
