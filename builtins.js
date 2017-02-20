/*global require,module,process*/
const commands = require("./commands");
const {NodeVM, VMScript} = require("vm2");

// class Eval extends commands.Command {
//     run(args) {
//         console.log("eval args");
//     }
// }

function* eval(jsh) {
    // eval arguments
    if (arguments.length > 1) {
        // combine them to a string
        var e = "";
        for (var i = 1; i < arguments.length; ++i) {
            e += arguments[i] + " ";
        }
        try {
            const script = new VMScript(e);
            jsh.shell.vm.run(script);
        } catch (e) {
            console.error("error running script", e);
        }
        console.log(jsh.shell.vm._context);
    }
    if (jsh.stdin) {
        // eval stdin
        while (jsh.stdin.open()) {
            var input = yield* jsh.stdin.read();
        }
    }
}

function exit(jsh)
{
    console.log("env at exit", jsh.shell.environment);
    process.exit();
}

module.exports = {
    init: function() {
        commands.add("eval", eval);
        commands.add("exit", exit);
    }
};
