/*global require,module,process*/

function eval(jsh) {
    // eval arguments
    const escape = (obj) => {
        if (jsh.shell.parent) {
            for (var k in obj) {
                jsh.shell.parent.set(k, obj[k]);
            }
            console.log(jsh.shell.parent.environment);
        } else {
            console.log(jsh.shell.environment);
        }
    };
    if (arguments.length > 1) {
        // each argument gets executed in order
        for (var i = 1; i < arguments.length; ++i) {
            try {
                jsh.shell.vm.run("" + arguments[i]);
            } catch (e) {
                console.error("error running script", e);
            }
        }
        escape(jsh.shell.environment);
    }
    if (jsh.io.stdin) {
        // eval stdin
        var all = [];
        jsh.io.stdin.on("data", (data) => {
            all.push(data);
        });
        jsh.io.stdin.on("close", () => {
            // make a string out of the datas
            var str = "";
            for (var i = 0; i < all.length; ++i) {
                str += all[i].toString("utf8");
            }
            // eval this thing
            try {
                jsh.shell.vm.run(str);
            } catch (e) {
                console.error("error running script", e);
            }
            escape(jsh.shell.environment);
        });
    }
}

function exit(jsh)
{
    console.log("jsh at exit", jsh);
    process.exit();
}

module.exports = {
    init: function init() {
        const commands = require("./commands");
        const jconsole = require("./console");
        const completions = require("./completions");
        const jobcontrol = require("./jobcontrol");
        commands.add("eval", eval);
        commands.add("exit", exit);
        commands.add("cd", (jsh, dir) => {
            try {
                if (dir == "-") {
                    dir = jsh.shell.env.OLDPWD || process.cwd();
                }
                let old = process.cwd();
                process.chdir(dir);
                jsh.shell.env.OLDPWD = old;
                jsh.shell.env.PWD = process.cwd();
                completions.update(completions.PWD, dir);
            } catch (e) {
                console.error(`cd failed: ${dir}`);
            }
        });
        commands.add("pwd", process.cwd);
        commands.add("rehash", jconsole.rehash);
        commands.add("jobs", jobcontrol.jobs);
        commands.add("fg", undefined, undefined, jobcontrol.fg);
        commands.add("bg", undefined, undefined, jobcontrol.bg);
        commands.add("export", (jsh, ...vals) => {
            for (let idx = 0; idx < vals.length; ++idx) {
                let key = vals[idx];

                // find '=' in key
                let eq = key.indexOf('=');
                if (eq == -1) {
                    if (key in jsh.shell.vars) {
                        jsh.shell.env[key] = jsh.shell.vars[key];
                        delete jsh.shell.vars[key];
                    }
                    continue;
                }
                let value = key.substr(eq + 1);
                key = key.substr(0, eq);
                if (!key.length)
                    return;
                jsh.shell.env[key] = value;
            }
        });
        commands.add("unset", (jsh, ...keys) => {
            for (let idx = 0; idx < keys.length; ++idx) {
                let key = keys[idx];
                if (key in jsh.shell.env)
                    delete jsh.shell.env[key];
            }
        });
        commands.add("alias", require("./alias"));
        commands.add("js", (jsh, mode) => {
            let on = true;
            if (typeof mode == "boolean")
                on = mode;
            else if (typeof mode == "string")
                on = (mode == "on" || mode == "yes");
            jsh.shell.js = on;
        });
    }
};
