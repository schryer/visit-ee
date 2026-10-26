// Everything the templates draw from: languages, strings, sites and the
// list of pages to write (lib/content.js has the rules).
import { load } from "../../lib/content.js";

export default function () {
  return load(process.env.VISIT_EE_CONTENT || ".", { baseUrl: process.env.VISIT_EE_URL || "" });
}
