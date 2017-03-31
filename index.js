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

    //console.log(jsh.commands);

    const jshconsole = require("./lib/console");
    const commands = require("./lib/commands");
    const builtins = require("./lib/builtins");

    commands.init();
    builtins.init();

    if (native.interactive) {
        jshconsole.run(`${homedir}/.jsh_history`);
        require("./lib/loadrc")(jshconsole);

        jshconsole.rehash();
    } else {
        // we'll want to read arguments at this point and execute commands
    }
})();
