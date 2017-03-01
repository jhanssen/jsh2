/*global require,module*/

const native = require("native-jsh");
const readline = require("native-readline");
const Job = native.Job;
const jshcommands = require("../commands");

const CommandBase = require("./commandbase");
const ScriptJob = require("./scriptjob");

class CommandPipeline extends CommandBase {
    run(jsh) {
        let Mode = { Native: 0, JS: 1 };
        let mode = undefined;
        let cmds = this.commands.slice();
        let len = this.commands.length;
        let async = cmds[len - 1].async;
        let job = undefined;
        let jscmd;

        let chain = (oldjob, newjob) => {
            job.on("stateChanged", (state) => {
                newjob.close();
            });
            oldjob.on("stdout", newjob.write);
            oldjob.on("stderr", (buf) => { readline.error(buf.toString("utf8")); });
        };

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
                    let newjob = new ScriptJob(jsh);
                    mode = Mode.JS;

                    // stdout of existing job becomes stdin of next job
                    job.start(Job.Background | Job.DupStdin);
                    chain(job, newjob);
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
                    let newjob = new Job();
                    mode = Mode.Native;

                    // stdout of existing job becomes stdin of next job
                    job.start(Job.Background | Job.DupStdin);
                    chain(job, newjob);
                    job = newjob;
                }
                job.add({ path: cmd.name, args: cmd.args, environ: cmd.assignments });
            }
        }

        if (job == undefined)
            return;

        // and then finally we need to start the last job chain
        job.on("stateChanged", (state) => {
            if (state == Job.Terminated) {
                if (!async) {
                    native.restore();
                    readline.resume(() => {
                        this._notify(state);
                    });
                } else {
                    this._notify(state);
                }
            }
        });
        if (async) {
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
        }
    }
};

module.exports = CommandPipeline;
