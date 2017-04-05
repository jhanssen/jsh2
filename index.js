/*global require,process*/

"use strict";

(() => {
    const semver = require("semver");
    if (!semver.gte(process.versions.node, "7.6.0")) {
        console.error("requires node >= 7.6.0");
        process.exit();
    }
})();

process.on('uncaughtException', (err) => {
    console.error("uncaught exception", err);
});

const nativeJsh = require("native-jsh");
const nativeIpc = require("native-ipc");
const native = nativeJsh.init();
const homedir = require('homedir')();

(() => {
    let oldexit = process.exit;
    process.exit = function(code) {
        jshconsole.stop();
        nativeJsh.deinit();
        nativeIpc.stop();
        oldexit.call(this, code);
    };

    //console.log(jsh.commands);

    const jshconsole = require("./lib/console");
    const commands = require("./lib/commands");
    const builtins = require("./lib/builtins");

    commands.init();
    builtins.init();

    if (native.interactive) {
        jshconsole.run(`${homedir}/.jsh_history`, `${homedir}/.jsh_history.js`);
        require("./lib/loadrc")(jshconsole).then(() => {
            jshconsole.rehash();
        });
    } else {
        // we'll want to read arguments at this point and execute commands
    }
})();
