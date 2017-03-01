/*global require,module,process*/

function eval(jsh) {
    // eval arguments
    const escape = (obj) => {
        for (var k in obj) {
            jsh.shell.parent.set(k, obj[k]);
        }
        console.log(jsh.shell.parent.environment);
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
    if (jsh.stdin) {
        // eval stdin
        var all = [];
        jsh.stdin.on("data", (data) => {
            all.push(data);
        });
        jsh.stdin.on("close", () => {
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
    console.log("env at exit", jsh.shell.environment);
    process.exit();
}

module.exports = {
    init: function() {
        const commands = require("./commands");
        commands.add("eval", eval);
        commands.add("exit", exit);
        commands.add("cd", process.chdir);
        commands.add("pwd", process.cwd);
    }
};
