/*global require,module,process*/

const native = require("native-jsh");
const readline = require("native-readline");
const Job = native.Job;
const jshcommands = require("../commands");
const jobcontrol = require("../jobcontrol");

const CommandBase = require("./commandbase");
const ScriptJob = require("./scriptjob");

class CommandPipeline extends CommandBase {
    run(jsh, asyncOverride, io) {
        let env = (cmd) => {
            let ce = cmd.assigns || {};
            let se = jsh.shell.env;
            for (var k in se) {
                if (!(k in ce))
                    ce[k] = se[k];
            }
            return ce;
        };

        let Mode = { Native: 0, JS: 1 };
        let mode = undefined;
        let cmds = this.commands.slice();
        let len = this.commands.length;
        let async = asyncOverride || cmds[len - 1].async;
        let job = undefined;
        let jscmd;

        let chain = (oldjob, newjob) => {
            job.on("stateChanged", (state) => {
                // console.log("closing");
                newjob.close();
            });
            oldjob.on("stdout", (buf) => { newjob.write(buf); });
            oldjob.on("stderr", (buf) => { readline.error(buf.toString("utf8")); });
        };

        let length = 1;

        for (let i = 0; i < len; ++i) {
            let cmd = cmds[i];
            if ((jscmd = jshcommands.find(cmd.name))) {
                if (mode == undefined || mode == Mode.JS) {
                    if (mode == undefined) {
                        mode = Mode.JS;
                        job = new ScriptJob(jsh);
                    }
                    // we're good, continue adding
                } else {
                    ++length;
                    let newjob = new ScriptJob(jsh);
                    mode = Mode.JS;

                    // stdout of existing job becomes stdin of next job
                    chain(job, newjob);
                    job.start(Job.Background, Job.DupStdin);
                    jobcontrol.add(job);
                    job = newjob;
                }
                job.add({ command: cmd, script: jscmd });
            } else {
                if (mode == undefined || mode == Mode.Native) {
                    if (mode == undefined) {
                        mode = Mode.Native;
                        job = new Job();
                    }
                } else {
                    // switching modes
                    ++length;
                    let newjob = new Job();
                    mode = Mode.Native;

                    // stdout of existing job becomes stdin of next job
                    chain(job, newjob);
                    job.start(Job.Background, Job.DupStdin);
                    jobcontrol.add(job);
                    job = newjob;
                }
                job.add({ path: cmd.name, args: cmd.args, environ: env(cmd) });
            }
        }

        if (job == undefined)
            return;

        // and then finally we need to start the last job chain
        job.on("stateChanged", (state, status) => {
            if (state == Job.Terminated
                || state == Job.Failed) {
                this.status = status;
                if (!async) {
                    native.restore();
                    readline.resume(() => {
                        if (state == Job.Failed)
                            console.log("command failed");
                        this._notify();
                    });
                } else {
                    if (state == Job.Failed)
                        console.log("command failed");
                    this._notify(asyncOverride == true);
                }
            }
        });
        if (async) {
            job.on("stdout", (buf) => {
                if (io) {
                    io.stdout(buf.toString("utf8"));
                } else {
                    readline.log(buf.toString("utf8"));
                }
            });
            job.on("stderr", (buf) => {
                if (io) {
                    io.stderr(buf.toString("utf8"));
                } else {
                    readline.error(buf.toString("utf8"));
                }
            });
            job.start(Job.Background, Job.DupStdin);
            jobcontrol.add(job);
        } else {
            readline.pause(() => {
                job.start(Job.Foreground, length < 2 ? 0 : Job.DupStdin);
                jobcontrol.add(job, true);
            });
        }
    }
};

module.exports = CommandPipeline;
