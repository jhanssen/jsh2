/*global module*/

const TokenizeState = { Normal: 0, Escaped: 1, SingleQuote: 2, DoubleQuote: 3, Expansion: 4 };

// a bit sad I have to do this since I have an otherwise decent bash parser
function tokenize(buffer, start, end)
{
    let state = [TokenizeState.Normal];
    let lastState = () => {
        return state[state.length - 1];
    };

    let out = [];
    let cur = "";
    let beforeStart = 0;
    let beforeEnd = 0;
    let exp = [];
    let pendingExp = undefined;
    let pendingBrace = false;
    let finalizePendingExp = idx => {
        if (pendingExp === undefined)
            return false;

        let text;
        if (!pendingBrace) {
            text = buffer.substr(pendingExp + 1, idx - pendingExp - 1);
        } else {
            let end = idx - 1;
            if (end < buffer.length && buffer[end] == '}') {
                text = buffer.substr(pendingExp + 2, idx - pendingExp - 3);
            } else {
                text = buffer.substr(pendingExp + 2);
            }
        }
        exp.push({ text: text, start: pendingExp, end: idx });
        pendingExp = undefined;
        pendingBrace = false;
        return true;
    };

    let befores = idx => {
        if (idx <= start)
            ++beforeStart;
        else if (idx <= end)
            ++beforeEnd;
    };

    for (var i = 0; i < buffer.length; ++i) {
        switch (buffer[i]) {
        case '\\':
            if (lastState() == TokenizeState.Normal) {
                if (!pendingBrace) {
                    if (finalizePendingExp(i))
                        state.pop();
                }

                state.push(TokenizeState.Escaped);
                befores(i);
                // don't reescape quotes
                // if (i + 1 < buffer.length) {
                //     switch (buffer[i + 1]) {
                //     case '"':
                //     case '\'':
                //     case ' ':
                //         befores(i);
                //         break;
                //     default:
                //         cur += '\\';
                //         break;
                //     }
                // } else {
                //     cur += '\\';
                // }
            } else if (lastState() == TokenizeState.Escaped) {
                state.pop();
                cur += '\\';
            }
            break;
        case '"':
            if (lastState() == TokenizeState.Normal) {
                befores(i);
                state.push(TokenizeState.DoubleQuote);
            } else if (lastState() == TokenizeState.DoubleQuote) {
                if (finalizePendingExp(i))
                    state.pop();

                befores(i);
                state.pop();
            } else if (lastState() == TokenizeState.Escaped) {
                state.pop();
                cur += '"';
            }
            break;
        case '\'':
            if (lastState() == TokenizeState.Normal) {
                befores(i);
                state.push(TokenizeState.SingleQuote);
            } else if (lastState() == TokenizeState.SingleQuote) {
                befores(i);
                state.pop();
            } else if (lastState() == TokenizeState.Escaped) {
                state.pop();
                cur += '\'';
            } else if (!pendingBrace) {
                if (finalizePendingExp(i))
                    state.pop();
            }
            break;
        case ' ':
            if (!pendingBrace) {
                if (finalizePendingExp(i))
                    state.pop();
                if (lastState() == TokenizeState.Normal) {
                    befores(i);
                    if (cur.length > 0) {
                        out.push(cur);
                        cur = "";
                    }
                } else {
                    cur += ' ';
                }
            } else {
                cur += ' ';
            }
            break;
        case '$':
            switch (lastState()) {
            case TokenizeState.Normal:
            case TokenizeState.DoubleQuote:
            case TokenizeState.Expansion:
                // expansion:
                if (!pendingBrace) {
                    finalizePendingExp(i);
                    pendingExp = i;
                    if (lastState() != TokenizeState.Expansion)
                        state.push(TokenizeState.Expansion);
                }
                break;
            default:
                break;
            }
            cur += buffer[i];
            break;
        case '{':
            if (pendingExp == i - 1) {
                // we're starting a brace expansion, continue until '}'
                pendingBrace = true;
            }
            cur += buffer[i];
            break;
        case '}':
            if (pendingBrace) {
                if (finalizePendingExp(i + 1))
                    state.pop();
            }
            cur += buffer[i];
            break;
        default:
            cur += buffer[i];
            break;
        }
    }

    finalizePendingExp(i);
    out.push(cur);

    return { tokens: out, state: lastState(), beforeStart: beforeStart, beforeEnd: beforeEnd, expansions: exp };
}

module.exports = {
    State: TokenizeState,
    tokenize: tokenize
};
