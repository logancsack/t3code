import { deferred } from "../../deferred";

export default deferred(() => import("../../../components/Sidebar").then((m) => m.default), {
  warm: true,
});
