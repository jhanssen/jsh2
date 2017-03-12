/*global require,module,process*/
const readline = require("native-readline");
const native = require("native-jsh");
const Job = native.Job;

const jobcontrol = {
    _jobs: new Map(),
    _fgJob: undefined,

    _nextId: function _nextId() {
        let id = 0;
        for (;; ++id) {
            if (!(jobcontrol._jobs.has(id)))
                return id;
        }
        return undefined;
    },

    add: function add(job, fg) {
        if (typeof job.command !== "function")
            return;
        let id = jobcontrol._nextId();
        if (fg)
            jobcontrol._fgJob = id;
        const stateChanged = (function(id, state) {
            if (state == job.Terminated) {
                // take the job out
                jobcontrol._jobs.delete(id);
            } else {
                jobcontrol._jobs.get(id).state = state;
                if (id == jobcontrol._fgJob && state == Job.Stopped) {
                    jobcontrol._fgJob = undefined;
                    native.restore();
                    readline.resume(() => {});
                }
            }
        }).bind(null, id);
        jobcontrol._jobs.set(id, { command: job.command(), state: undefined, job: job });
        job.on("stateChanged", stateChanged);
    },

    jobs: function jobs() {
        for (let id of jobcontrol._jobs) {
            let j = id[1];
            console.log(`${id[0]}: ${j.command} - ${j.state}`);
        }
    },

    fg: function fg(jsh, id) {
        if (!jobcontrol._jobs.has(id)) {
            return false;
        }
        let j = jobcontrol._jobs.get(id);
        process.nextTick(() => {
            readline.pause(() => {
                // throw "fitt";
                jobcontrol._fgJob = id;
                j.job.setMode(Job.Foreground);
            });
        });
        return true;
    },

    bg: function bg(jsh, id) {
        if (!jobcontrol._jobs.has(id))
            return false;
        let j = jobcontrol._jobs.get(id);
        process.nextTick(() => {
            j.job.setMode(Job.Background);
        });
        return true;
    }
};

module.exports = jobcontrol;
