/*global require,module,process*/

const EventEmitter = require("events");

const native = require("native-jsh");
const Job = native.Job;

const isGenerator = function isGenerator(fun) {
    return /^function\s*\*/.test(fun.toString());
};

class ScriptJob extends EventEmitter {
    constructor(jsh, command, script) {
        super();
        this.shell = jsh.shells[jsh.shells.length - 1];
        this.command = command;
        this.script = script;
    }

    start(flags) {
        if (isGenerator(this.script.cmd)) {
            // do stuff
            throw "No support for running generator functions yet";
        } else {
            // normal function
            let jsh = {
                io: {
                    stdout: (w) => { console.log(w); },
                    stderr: (w) => { console.error(w); }
                    //stdin: () => {}
                },
                shell: this.shell,
                environ: this.command.assignments
            };
            let ret;
            if (this.command.args === undefined) {
                ret = this.script.cmd(jsh);
            } else if (this.command.args instanceof Array) {
                ret = this.script.cmd(jsh, ...this.command.args);
            } else {
                ret = this.script.cmd(jsh, this.command.args);
            }
            let done = (ret, write) => {
                switch (typeof ret) {
                case "number":
                    this._notify(ret);
                    break;
                case "object":
                    write(JSON.stringify(ret));
                    if ("status" in ret) {
                        this._notify(ret.status);
                    } else {
                        this._notify(0);
                    }
                    break;
                case "string":
                    write(ret);
                    this._notify(0);
                    break;
                default:
                    this._notify(0);
                    break;
                }
            };
            if (ret instanceof Promise) {
                ret.then((ret) => { done(ret, jsh.io.stdout); }).catch((err) => { done(err, jsh.io.stderr); });
            } else {
                done(ret, jsh.io.stdout);
            }
        }
    }

    _notify(status) {
        process.nextTick(() => {
            this.emit("stateChanged", Job.Terminated, status);
        });
    }
};

module.exports = ScriptJob;
