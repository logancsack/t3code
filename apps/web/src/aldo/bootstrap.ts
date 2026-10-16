import { startup } from "../main";
import { showBootError } from "../lib/bootError";

void startup.catch(showBootError);
