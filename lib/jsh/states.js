/*global require,module,process*/

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
        this.subscriptions = { status: [], complete: [] };
        this.status = undefined;
        this.key = 0;
    }

    add(cmd) {
        this.commands.push(cmd);
    }

    subscribe(mode, cb) {
        let k = this.key++;
        this.subscriptions[mode].push({ k: k, cb: cb });
        if (this.status !== undefined) {
            process.nextTick(() => {
                cb(this.status);
            });
        }
        return k;
    }

    unsubscribe(mode, key) {
        let subs = this.subscriptions[mode];
        for (let i = 0; i < subs.length; ++i) {
            if (subs[i].k == key) {
                subs.splice(i, 1);
                return true;
            }
        }
        return false;
    }

    _notify(mode) {
        let subs = this.subscriptions[mode];
        for (let i = 0; i < subs.length; ++i)
            subs[i].cb(this.status);
    }
}

class CommandRunner extends CommandBase {
    run() {
        let cmds = this.commands.slice();
        let len = this.commands.length;
        let rem = len;
        for (let i = 0; i < len; ++i) {
            cmds[i].subscribe((status) => {
                this.commands.splice(i, 1);
                // we're really only interested in the status of the final command
                if (i == len - 1) {
                    this.status = status;
                }
                if (!--rem) {
                    // we're done, notify our listeners
                    this._notify("status");
                    // and if we're really done notify our other listeners
                    if (!this.commands.length)
                        this._notify("complete");
                }
            });
            cmds[i].run();
        }
    }
};

module.exports = { /*Commands: Commands,*/ Assignments: Assignments, CommandRunner: CommandRunner };
