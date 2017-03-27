/*global module,require*/

const minimatch = require("minimatch");
const tokenizer = require("../tokenizer");

function match(clause, items)
{
    if (items instanceof Array) {
        for (let idx = 0; idx < items.length; ++idx) {
            if (minimatch(clause, items[idx]))
                return true;
        }
    } else if (typeof items === "string") {
        return minimatch(clause, items);
    }
    return false;
}

class Glob
{
    constructor(str) {
        this.string = str;
    }

    get value() {
        return this.string;
    }
}

module.exports = {
    match: match,
    Glob: Glob
};
