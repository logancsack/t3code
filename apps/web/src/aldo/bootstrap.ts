import { startup } from "../main";
import { showAldoBootError } from "./bootError";
// After main's index.css, so Aldo's typeface wins the font tokens.
import "./fonts.css";

void startup.catch(showAldoBootError);
