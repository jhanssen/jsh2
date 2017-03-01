/*global require,module,process*/

const EventEmitter = require("events");

const native = require("native-jsh");
const Job = native.Job;

const isGenerator = function isGenerator(fun) {
    return /^function\s*\*/.test(fun.toString());
};

class Stdout extends EventEmitter {
    constructor() {
        super();
        this.buffer = [];
        this.closed = false;

        this.on("newListener", (event, listener) => {
            switch (event) {
            case "data":
                if (this.buffer.length > 0) {
                    process.nextTick(() => {
                        for (let i = 0; i < this.buffer.length; ++i) {
                            listener(this.buffer[i]);
                        }
                        this.buffer = [];
                    });
                }
                break;
            case "closed":
                if (this.closed) {
                    process.nextTick(() => {
                        listener();
                    });
                }
                break;
            }
        });
    }

    writer() {
        return (w) => {
            if (this.closed)
                return;
            if (this.listenerCount("data") > 0) {
                this.emit("data", w);
            } else {
                this.buffer.push(w);
            }
        };
    }

    close() {
        this.emit("closed");
        this.closed = true;
    }
};

class ScriptJob extends EventEmitter {
    constructor(jsh) {
        super();
        this.shell = jsh.shells[jsh.shells.length - 1];
        this.commands = [];
        this.stdout = new Stdout();
        this.stdin = this.stdout.writer();
    }

    add(cmd) {
        this.commands.push(cmd);
    }

    write(data) {
        this.stdin(data);
    }

    close() {
        this.stdout.close();
    }

    start(flags) {
        let stdin = this.stdout;
        let stdout = undefined;
        let stderr = (w) => { console.error(w); };
        let lastout = {
            writer: () => {
                return (w) => { console.log(w); };
            }
        };

        for (let i = 0; i < this.commands.length; ++i) {
            let command = this.commands[i].command;
            let script = this.commands[i].script;
            let last = i == this.commands.length - 1;
            if (last) {
                stdout = lastout;
            } else {
                stdout = new Stdout();
            }

            if (isGenerator(script.cmd)) {
                // do stuff
                throw "No support for running generator functions yet";
            } else {
                // normal function
                let outwriter = stdout.writer();

                let jsh = {
                    io: {
                        stdout: outwriter,
                        stderr: stderr,
                        stdin: stdin
                    },
                    shell: this.shell,
                    environ: command.assignments
                };
                let ret;
                if (command.args === undefined) {
                    ret = script.cmd(jsh);
                } else if (command.args instanceof Array) {
                    ret = script.cmd(jsh, ...command.args);
                } else {
                    ret = script.cmd(jsh, command.args);
                }

                let notify = (status) => {
                    process.nextTick(() => {
                        if (last) {
                            this.emit("stateChanged", Job.Terminated, status);
                        } else {
                            stdout.close();
                        }
                    });
                };

                let done = (ret, write) => {
                    switch (typeof ret) {
                    case "number":
                        notify(ret);
                        break;
                    case "object":
                        write(JSON.stringify(ret));
                        if ("status" in ret) {
                            notify(ret.status);
                        } else {
                            notify(0);
                        }
                        break;
                    case "string":
                        write(ret);
                        notify(0);
                        break;
                    default:
                        notify(0);
                        break;
                    }
                };

                if (ret instanceof Promise) {
                    ret.then((ret) => { done(ret, outwriter); }).catch((err) => { done(err, stderr); });
                } else {
                    done(ret, outwriter);
                }

                stdin = stdout;
            }
        }
    }
};

module.exports = ScriptJob;
