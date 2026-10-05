import {createHandler} from '../server/pelecard-transactions/handler.js';
import {authenticateAdmin} from '../server/pelecard-transactions/auth.js';
import {queryProvider} from '../server/pelecard-transactions/provider.js';
const read=name=>process.env[name];
const handle=createHandler({read,authenticate:bearer=>authenticateAdmin(bearer,read),query:input=>queryProvider(input,read)});
export default {fetch:handle};
