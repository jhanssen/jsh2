/*global require,process*/

"use strict";

const nativeJsh = require("native-jsh");
const native = nativeJsh.init();

const nodeCleanup = require('node-cleanup');
nodeCleanup(() => {
    nativeJsh.deinit();
});

function loadrc()
{
    const homedir = require('homedir')();
    try {
        const rc = require(`${homedir}/.config/jshrc`);
        let jsh = {
            commands: require("./lib/commands")
        };
        rc(jsh);
    } catch (e) {
        console.log("no rc file");
    }
}

const CodeRunner = require("./lib/coderunner/index");
const runner = new CodeRunner();
//console.log(jsh.commands);

{
    const console = require("./lib/console");
    const commands = require("./lib/commands");
    const builtins = require("./lib/builtins");

    commands.init();
    builtins.init();
    if (native.interactive) {
        console.run(runner);

        loadrc();
    } else {
        // we'll want to read arguments at this point and execute commands
    }
}
