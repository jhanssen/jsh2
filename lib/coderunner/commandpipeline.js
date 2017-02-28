/*global require,module*/

const native = require("native-jsh");
const readline = require("native-readline");
const Job = native.Job;

const CommandBase = require("./commandbase");

class CommandPipeline extends CommandBase {
    run() {
        let cmds = this.commands.slice();
        let len = this.commands.length;
        let async = cmds[len - 1].async;
        let job = new Job();
        for (let i = 0; i < len; ++i) {
            let cmd = cmds[i];
            job.add({ path: cmd.name, args: cmd.args, environ: cmd.assignments });
        }
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
