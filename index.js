/*global require,process*/

"use strict";

process.on('uncaughtException', (err) => {
    console.error("uncaught exception", err);
});

const nativeJsh = require("native-jsh");
const native = nativeJsh.init();
const homedir = require('homedir')();

(() => {
    let oldexit = process.exit;
    process.exit = function(code) {
        jshconsole.stop();
        nativeJsh.deinit();
        oldexit.call(this, code);
    };

    function loadrc(jshconsole)
    {
        try {
            const rc = require(`${homedir}/.config/jshrc`);
            let jsh = {
                commands: require("./lib/commands"),
                completions: require("./lib/completions"),
                setPrompt: func => { jshconsole.setPrompt(func); },
                homedir: homedir
            };
            rc(jsh);
        } catch (e) {
            //console.log("no rc file", e);
        }
    }

    const CodeRunner = require("./lib/coderunner/index");
    const runner = new CodeRunner();
    //console.log(jsh.commands);

    const jshconsole = require("./lib/console");
    const commands = require("./lib/commands");
    const builtins = require("./lib/builtins");

    commands.init();
    builtins.init();

    if (native.interactive) {
        jshconsole.run(runner, `${homedir}/.jsh_history`);

        loadrc(jshconsole);

        jshconsole.rehash();
    } else {
        // we'll want to read arguments at this point and execute commands
    }
})();
