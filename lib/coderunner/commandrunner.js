/*global require,module*/

const native = require("native-jsh");
const readline = require("native-readline");
const Job = native.Job;
const jshcommands = require("../commands");

const CommandBase = require("./commandbase");
const ScriptJob = require("./scriptjob");

class CommandRunner extends CommandBase {
    run() {
        var jscmd;
        let cmds = this.commands.slice();
        let len = this.commands.length;
        let runner = function*(that) {
            for (let i = 0; i < len; ++i) {
                let job;
                let cmd = cmds[i];
                if ((jscmd = jshcommands.find(cmd.name))) {
                    job = new ScriptJob(cmd, jscmd);
                } else {
                    job = new Job();
                    job.add({ path: cmd.name, args: cmd.args, environ: cmd.assignments });
                }
                if (cmd.async) {
                    job.on("stdout", (buf) => {
                        readline.log(buf.toString("utf8"));
                    });
                    job.on("stderr", (buf) => {
                        readline.error(buf.toString("utf8"));
                    });
                    job.start(Job.Background | Job.DupStdin);
                } else {
                    readline.pause(() => {
                        job.start();
                    });
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

module.exports = CommandRunner;
