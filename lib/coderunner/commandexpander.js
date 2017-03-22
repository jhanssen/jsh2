/*global require,module,process*/

const CommandBase = require("./commandbase");
const jshcommands = require("../commands");
const child_process = require("child_process");
const ScriptJob = require("./scriptjob");
const native = require("native-jsh");
const Job = native.Job;

class CommandExpander extends CommandBase {
    constructor() {
        super();
        this.stdout = undefined;
        this.stderr = undefined;
        this.status = undefined;
    }

    run(jsh) {
        // run synchronously and set this.stdout.data and this.stderr.data = output
        let promise = new Promise((resolve, reject) => {
            // we only support one command
            let env = (cmd) => {
                let ce = cmd.assigns || {};
                let se = jsh.shell.env;
                for (var k in se) {
                    if (!(k in ce))
                        ce[k] = se[k];
                }
                return ce;
            };

            let len = this.commands.length;
            if (len != 1) {
                throw `CommandExpander with ${len} commands not supported`;
            }
            let cmd = this.commands[0];
            let jscmd;
            if ((jscmd = jshcommands.find(cmd.name))) {
                // run js command sync? not sure how yet
                let jsjob = new ScriptJob(jsh);
                jsjob.add({ command: cmd, script: jscmd });
                let o = {
                    out: "",
                    err: ""
                };
                jsjob.on("stdout", (out) => {
                    o.out += out;
                });
                jsjob.on("stderr", (err) => {
                    o.err += err;
                });
                jsjob.on("stateChanged", (state, status) => {
                    if (state == Job.Terminated) {
                        this.stdout = o.out;
                        this.stderr = o.err;
                        this.status = status;
                        resolve();
                    }
                });
                jsjob.start(Job.Background);
            } else {
                // we're cheating a bit here, invoking bash
                let proc = child_process.spawn(cmd.name, cmd.args, { env: env(cmd), encoding: "utf8", shell: "/bin/bash" });
                let o = {
                    out: "",
                    err: ""
                };
                proc.stdout.on("data", (out) => {
                    o.out += out;
                });
                proc.stderr.on("data", (err) => {
                    o.err += err;
                });
                proc.on("close", (status) => {
                    this.stdout = o.out;
                    this.stderr = o.err;
                    this.status = status;
                    resolve();
                });
                proc.on("error", (err) => {
                    reject(err);
                });
            }
        });
        return promise;
    }
};

module.exports = CommandExpander;
