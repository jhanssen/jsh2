/*global module*/

const commands = {
    _commands: {},

    init: function init() {
    },

    add: function add(name, cmd, opts) {
        if (typeof cmd !== "function")
            throw `Can't register ${cmd} as function, typeof is ${typeof cmd}`;
        commands._commands[name] = { cmd: cmd, opts: opts };
    },

    remove: function remove(name) {
        delete commands._commands[name];
    },

    find: function find(name) {
        if (name in commands._commands)
            return commands._commands[name];
        return null;
    },

    get names() {
        return Object.keys(commands._commands);
    },

    isGenerator: function isGenerator(fun) {
        return /^function\s*\*/.test(fun.toString());
    }
};

module.exports = commands;
