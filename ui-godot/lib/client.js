window.__ModuleLoader__.load({ id: "@deepseek-ai/dsh-ui-godot", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
let react = require("react");
react = __toESM(react);
let __deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
__deepseek_ai_dsh_client_ui_primitives = __toESM(__deepseek_ai_dsh_client_ui_primitives);
let react_jsx_runtime = require("react/jsx-runtime");
react_jsx_runtime = __toESM(react_jsx_runtime);
let __deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
__deepseek_ai_dsh_client_store = __toESM(__deepseek_ai_dsh_client_store);

//#region \0godot-asset:D:/projects/dsh-godot/ui-godot/src/client/assets/godot-logo.svg.mjs
var godot_logo_svg_default = "data:image/svg+xml,%3C%3Fxml%20version%3D%221.0%22%20encoding%3D%22UTF-8%22%20standalone%3D%22no%22%3F%3E%0A%3Csvg%0A%20%20%20width%3D%221024%22%0A%20%20%20height%3D%221024%22%0A%20%20%20id%3D%22svg3030%22%0A%20%20%20version%3D%221.1%22%0A%20%20%20inkscape%3Aversion%3D%221.1%20(c68e22c387%2C%202021-05-23)%22%0A%20%20%20sodipodi%3Adocname%3D%22godot_icon.svg%22%0A%20%20%20inkscape%3Aexport-filename%3D%22%2Fhome%2Fakien%2FProjects%2Fgodot%2Fgodot.git%2Ficon.png%22%0A%20%20%20inkscape%3Aexport-xdpi%3D%2224%22%0A%20%20%20inkscape%3Aexport-ydpi%3D%2224%22%0A%20%20%20xmlns%3Ainkscape%3D%22http%3A%2F%2Fwww.inkscape.org%2Fnamespaces%2Finkscape%22%0A%20%20%20xmlns%3Asodipodi%3D%22http%3A%2F%2Fsodipodi.sourceforge.net%2FDTD%2Fsodipodi-0.dtd%22%0A%20%20%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%0A%20%20%20xmlns%3Asvg%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%0A%20%20%20xmlns%3Ardf%3D%22http%3A%2F%2Fwww.w3.org%2F1999%2F02%2F22-rdf-syntax-ns%23%22%0A%20%20%20xmlns%3Acc%3D%22http%3A%2F%2Fcreativecommons.org%2Fns%23%22%0A%20%20%20xmlns%3Adc%3D%22http%3A%2F%2Fpurl.org%2Fdc%2Felements%2F1.1%2F%22%3E%0A%20%20%3Cdefs%0A%20%20%20%20%20id%3D%22defs3032%22%20%2F%3E%0A%20%20%3Csodipodi%3Anamedview%0A%20%20%20%20%20id%3D%22base%22%0A%20%20%20%20%20pagecolor%3D%22%23ffffff%22%0A%20%20%20%20%20bordercolor%3D%22%23666666%22%0A%20%20%20%20%20borderopacity%3D%221.0%22%0A%20%20%20%20%20inkscape%3Apageopacity%3D%220.0%22%0A%20%20%20%20%20inkscape%3Apageshadow%3D%222%22%0A%20%20%20%20%20inkscape%3Azoom%3D%220.8359375%22%0A%20%20%20%20%20inkscape%3Acx%3D%22511.40187%22%0A%20%20%20%20%20inkscape%3Acy%3D%22416.29907%22%0A%20%20%20%20%20inkscape%3Adocument-units%3D%22px%22%0A%20%20%20%20%20inkscape%3Acurrent-layer%3D%22g82-3%22%0A%20%20%20%20%20showgrid%3D%22false%22%0A%20%20%20%20%20inkscape%3Awindow-width%3D%222560%22%0A%20%20%20%20%20inkscape%3Awindow-height%3D%221377%22%0A%20%20%20%20%20inkscape%3Awindow-x%3D%221912%22%0A%20%20%20%20%20inkscape%3Awindow-y%3D%22-8%22%0A%20%20%20%20%20inkscape%3Awindow-maximized%3D%221%22%0A%20%20%20%20%20inkscape%3Adocument-rotation%3D%220%22%0A%20%20%20%20%20inkscape%3Apagecheckerboard%3D%220%22%20%2F%3E%0A%20%20%3Cmetadata%0A%20%20%20%20%20id%3D%22metadata3035%22%3E%0A%20%20%20%20%3Crdf%3ARDF%3E%0A%20%20%20%20%20%20%3Ccc%3AWork%0A%20%20%20%20%20%20%20%20%20rdf%3Aabout%3D%22%22%3E%0A%20%20%20%20%20%20%20%20%3Cdc%3Aformat%3Eimage%2Fsvg%2Bxml%3C%2Fdc%3Aformat%3E%0A%20%20%20%20%20%20%20%20%3Cdc%3Atype%0A%20%20%20%20%20%20%20%20%20%20%20rdf%3Aresource%3D%22http%3A%2F%2Fpurl.org%2Fdc%2Fdcmitype%2FStillImage%22%20%2F%3E%0A%20%20%20%20%20%20%3C%2Fcc%3AWork%3E%0A%20%20%20%20%3C%2Frdf%3ARDF%3E%0A%20%20%3C%2Fmetadata%3E%0A%20%20%3Cg%0A%20%20%20%20%20inkscape%3Alabel%3D%22Layer%201%22%0A%20%20%20%20%20inkscape%3Agroupmode%3D%22layer%22%0A%20%20%20%20%20id%3D%22layer1%22%0A%20%20%20%20%20transform%3D%22translate(0%2C-98.519719)%22%0A%20%20%20%20%20style%3D%22display%3Ainline%22%3E%0A%20%20%20%20%3Cg%0A%20%20%20%20%20%20%20id%3D%22g78%22%0A%20%20%20%20%20%20%20transform%3D%22matrix(4.162611%2C0%2C0%2C-4.162611%2C919.24059%2C771.67186)%22%0A%20%20%20%20%20%20%20style%3D%22display%3Anone%3Bstroke-width%3A0.320312%22%3E%0A%20%20%20%20%20%20%3Cpath%0A%20%20%20%20%20%20%20%20%20d%3D%22m%200%2C0%20c%200%2C0%20-0.325%2C1.994%20-0.515%2C1.976%20l%20-36.182%2C-3.491%20c%20-2.879%2C-0.278%20-5.115%2C-2.574%20-5.317%2C-5.459%20l%20-0.994%2C-14.247%20-27.992%2C-1.997%20-1.904%2C12.912%20c%20-0.424%2C2.872%20-2.932%2C5.037%20-5.835%2C5.037%20h%20-38.188%20c%20-2.902%2C0%20-5.41%2C-2.165%20-5.834%2C-5.037%20l%20-1.905%2C-12.912%20-27.992%2C1.997%20-0.994%2C14.247%20c%20-0.202%2C2.886%20-2.438%2C5.182%20-5.317%2C5.46%20l%20-36.2%2C3.49%20c%20-0.187%2C0.018%20-0.324%2C-1.978%20-0.511%2C-1.978%20l%20-0.049%2C-7.83%2030.658%2C-4.944%201.004%2C-14.374%20c%200.203%2C-2.91%202.551%2C-5.263%205.463%2C-5.472%20l%2038.551%2C-2.75%20c%200.146%2C-0.01%200.29%2C-0.016%200.434%2C-0.016%202.897%2C0%205.401%2C2.166%205.825%2C5.038%20l%201.959%2C13.286%20h%2028.005%20l%201.959%2C-13.286%20c%200.423%2C-2.871%202.93%2C-5.037%205.831%2C-5.037%200.142%2C0%200.284%2C0.005%200.423%2C0.015%20l%2038.556%2C2.75%20c%202.911%2C0.209%205.26%2C2.562%205.463%2C5.472%20l%201.003%2C14.374%2030.645%2C4.966%20z%22%0A%20%20%20%20%20%20%20%20%20style%3D%22fill%3A%23ffffff%3Bfill-opacity%3A1%3Bfill-rule%3Anonzero%3Bstroke%3Anone%3Bstroke-width%3A0.320312%22%0A%20%20%20%20%20%20%20%20%20id%3D%22path80%22%0A%20%20%20%20%20%20%20%20%20inkscape%3Aconnector-curvature%3D%220%22%20%2F%3E%0A%20%20%20%20%3C%2Fg%3E%0A%20%20%20%20%3Cg%0A%20%20%20%20%20%20%20id%3D%22g82-3%22%0A%20%20%20%20%20%20%20transform%3D%22matrix(4.162611%2C0%2C0%2C-4.162611%2C104.69892%2C525.90697)%22%0A%20%20%20%20%20%20%20style%3D%22display%3Ainline%3Bstroke-width%3A0.320312%22%3E%0A%20%20%20%20%20%20%3Cpath%0A%20%20%20%20%20%20%20%20%20id%3D%22path84-6%22%0A%20%20%20%20%20%20%20%20%20style%3D%22fill%3A%23478cbf%3Bfill-opacity%3A1%3Bfill-rule%3Anonzero%3Bstroke%3Anone%3Bstroke-width%3A1.33333%22%0A%20%20%20%20%20%20%20%20%20d%3D%22m%20417.61523%2C76.875%20c%20-42.39201%2C9.424151%20-84.32671%2C22.544942%20-123.64257%2C42.33398%200.89912%2C34.71618%203.14362%2C67.97967%207.69336%2C101.76758%20-15.26846%2C9.78214%20-31.31507%2C18.17757%20-45.57618%2C29.62891%20-14.49005%2C11.14747%20-29.2896%2C21.81231%20-42.41015%2C34.84961%20C%20187.46773%2C268.1178%20159.72502%2C251.82518%20131.14453%2C237.44336%20100.33705%2C270.59856%2071.53124%2C306.38344%2048%2C346.42773%20c%2018.493057%2C29.02877%2038.32949%2C58.20569%2056.69922%2C80.95899%20v%20197.7832%2025.1211%2022.86132%20c%200.44956%2C0.004%200.89835%2C0.0209%201.34375%2C0.0625%20l%20150.66992%2C14.52735%20c%207.89231%2C0.76176%2014.07749%2C7.11449%2014.62695%2C15.02343%20l%204.64649%2C66.50977%20131.42969%2C9.37891%209.05468%2C-61.38672%20c%201.17386%2C-7.95891%208.00029%2C-13.85742%2016.05078%2C-13.85742%20h%20158.96094%20c%208.04633%2C0%2014.87302%2C5.89851%2016.04688%2C13.85742%20l%209.05468%2C61.38672%20131.4336%2C-9.37891%204.64258%2C-66.50977%20c%200.55362%2C-7.90894%206.73464%2C-14.25751%2014.62695%2C-15.02343%20l%20150.61133%2C-14.52735%20c%200.4454%2C-0.0416%200.89028%2C-0.0583%201.33984%2C-0.0625%20v%20-19.61132%20l%200.0625%2C-0.0195%20v%20-226.1348%20c%2021.2165%2C-26.70928%2041.30684%2C-56.1715%2056.69922%2C-80.95899%20-23.52291%2C-40.04429%20-52.34486%2C-75.82917%20-83.15234%2C-108.98437%20-28.57217%2C14.38182%20-56.32515%2C30.67444%20-82.53711%2C48.01172%20-13.11639%2C-13.0373%20-27.88953%2C-23.70214%20-42.40039%2C-34.84961%20-14.25695%2C-11.45134%20-30.32318%2C-19.84677%20-45.5625%2C-29.62891%204.53724%2C-33.78791%206.7803%2C-67.0514%207.68359%2C-101.76758%20C%20690.71123%2C99.419942%20648.78198%2C86.299151%20606.36914%2C76.875%20c%20-16.9335%2C28.45977%20-32.41939%2C59.27922%20-45.90625%2C89.4082%20-15.99275%2C-2.67239%20-32.05995%2C-3.66203%20-48.14844%2C-3.85351%20v%20-0.0254%20c%20-0.11239%2C0%20-0.21676%2C0.0254%20-0.3125%2C0.0254%20-0.0999%2C0%20-0.20478%2C-0.0254%20-0.30468%2C-0.0254%20v%200.0254%20c%20-16.11763%2C0.19148%20-32.17106%2C1.18112%20-48.16797%2C3.85351%20C%20450.05076%2C136.15422%20434.57371%2C105.33477%20417.61523%2C76.875%20Z%20M%20298.41602%2C436.39844%20c%2050.15111%2C0%2090.79882%2C40.61746%2090.79882%2C90.75195%200%2C50.16779%20-40.64771%2C90.80859%20-90.79882%2C90.80859%20-50.12617%2C0%20-90.78711%2C-40.6408%20-90.78711%2C-90.80859%200%2C-50.13449%2040.66094%2C-90.75195%2090.78711%2C-90.75195%20z%20m%20427.17773%2C0%20c%2050.122%2C0%2090.7793%2C40.61746%2090.7793%2C90.75195%200%2C50.16779%20-40.6573%2C90.80859%20-90.7793%2C90.80859%20-50.15946%2C0%20-90.80664%2C-40.6408%20-90.80664%2C-90.80859%200%2C-50.13449%2040.64718%2C-90.75195%2090.80664%2C-90.75195%20z%20m%20-213.59961%2C53.10937%20c%2016.14261%2C0%2029.25391%2C11.90816%2029.25391%2C26.56055%20v%2083.58984%20c%200%2C14.66488%20-13.1113%2C26.5625%20-29.25391%2C26.5625%20-16.1426%2C0%20-29.22656%2C-11.89762%20-29.22656%2C-26.5625%20v%20-83.58984%20c%200%2C-14.65239%2013.08396%2C-26.56055%2029.22656%2C-26.56055%20z%22%0A%20%20%20%20%20%20%20%20%20transform%3D%22matrix(0.24023383%2C0%2C0%2C-0.24023383%2C-25.152223%2C102.67288)%22%20%2F%3E%0A%20%20%20%20%3C%2Fg%3E%0A%20%20%20%20%3Cg%0A%20%20%20%20%20%20%20id%3D%22g86-7%22%0A%20%20%20%20%20%20%20transform%3D%22matrix(4.162611%2C0%2C0%2C-4.162611%2C784.07144%2C817.24284)%22%0A%20%20%20%20%20%20%20style%3D%22display%3Ainline%3Bstroke-width%3A0.320312%22%3E%0A%20%20%20%20%20%20%3Cpath%0A%20%20%20%20%20%20%20%20%20d%3D%22m%200%2C0%20-1.121%2C-16.063%20c%20-0.135%2C-1.936%20-1.675%2C-3.477%20-3.611%2C-3.616%20l%20-38.555%2C-2.751%20c%20-0.094%2C-0.007%20-0.188%2C-0.01%20-0.281%2C-0.01%20-1.916%2C0%20-3.569%2C1.406%20-3.852%2C3.33%20l%20-2.211%2C14.994%20H%20-81.09%20l%20-2.211%2C-14.994%20c%20-0.297%2C-2.018%20-2.101%2C-3.469%20-4.133%2C-3.32%20l%20-38.555%2C2.751%20c%20-1.936%2C0.139%20-3.476%2C1.68%20-3.611%2C3.616%20L%20-130.721%2C0%20-163.268%2C3.138%20c%200.015%2C-3.498%200.06%2C-7.33%200.06%2C-8.093%200%2C-34.374%2043.605%2C-50.896%2097.781%2C-51.086%20h%200.066%200.067%20c%2054.176%2C0.19%2097.766%2C16.712%2097.766%2C51.086%200%2C0.777%200.047%2C4.593%200.063%2C8.093%20z%22%0A%20%20%20%20%20%20%20%20%20style%3D%22fill%3A%23478cbf%3Bfill-opacity%3A1%3Bfill-rule%3Anonzero%3Bstroke%3Anone%3Bstroke-width%3A0.320312%22%0A%20%20%20%20%20%20%20%20%20id%3D%22path88-5%22%0A%20%20%20%20%20%20%20%20%20inkscape%3Aconnector-curvature%3D%220%22%20%2F%3E%0A%20%20%20%20%3C%2Fg%3E%0A%20%20%20%20%3Cg%0A%20%20%20%20%20%20%20id%3D%22g90-3%22%0A%20%20%20%20%20%20%20transform%3D%22matrix(4.162611%2C0%2C0%2C-4.162611%2C389.21484%2C625.67104)%22%0A%20%20%20%20%20%20%20style%3D%22display%3Anone%3Bstroke-width%3A0.320312%22%20%2F%3E%0A%20%20%20%20%3Cg%0A%20%20%20%20%20%20%20id%3D%22g94-6%22%0A%20%20%20%20%20%20%20transform%3D%22matrix(4.162611%2C0%2C0%2C-4.162611%2C367.36686%2C631.05679)%22%0A%20%20%20%20%20%20%20style%3D%22display%3Anone%3Bstroke-width%3A0.320312%22%3E%0A%20%20%20%20%20%20%3Cpath%0A%20%20%20%20%20%20%20%20%20d%3D%22m%200%2C0%20c%200%2C-7.994%20-6.479%2C-14.473%20-14.479%2C-14.473%20-7.996%2C0%20-14.479%2C6.479%20-14.479%2C14.473%200%2C7.994%206.483%2C14.479%2014.479%2C14.479%20C%20-6.479%2C14.479%200%2C7.994%200%2C0%22%0A%20%20%20%20%20%20%20%20%20style%3D%22fill%3A%23414042%3Bfill-opacity%3A1%3Bfill-rule%3Anonzero%3Bstroke%3Anone%3Bstroke-width%3A0.320312%22%0A%20%20%20%20%20%20%20%20%20id%3D%22path96-2%22%0A%20%20%20%20%20%20%20%20%20inkscape%3Aconnector-curvature%3D%220%22%20%2F%3E%0A%20%20%20%20%3C%2Fg%3E%0A%20%20%20%20%3Cg%0A%20%20%20%20%20%20%20id%3D%22g98-9%22%0A%20%20%20%20%20%20%20transform%3D%22matrix(4.162611%2C0%2C0%2C-4.162611%2C511.99336%2C724.73954)%22%0A%20%20%20%20%20%20%20style%3D%22display%3Ainline%3Bstroke-width%3A0.320312%22%20%2F%3E%0A%20%20%20%20%3Cg%0A%20%20%20%20%20%20%20id%3D%22g102-2%22%0A%20%20%20%20%20%20%20transform%3D%22matrix(4.162611%2C0%2C0%2C-4.162611%2C634.78706%2C625.67104)%22%0A%20%20%20%20%20%20%20style%3D%22display%3Anone%3Bstroke-width%3A0.320312%22%20%2F%3E%0A%20%20%20%20%3Cg%0A%20%20%20%20%20%20%20id%3D%22g106-0%22%0A%20%20%20%20%20%20%20transform%3D%22matrix(4.162611%2C0%2C0%2C-4.162611%2C656.64056%2C631.05679)%22%0A%20%20%20%20%20%20%20style%3D%22display%3Anone%3Bstroke-width%3A0.320312%22%3E%0A%20%20%20%20%20%20%3Cpath%0A%20%20%20%20%20%20%20%20%20d%3D%22m%200%2C0%20c%200%2C-7.994%206.477%2C-14.473%2014.471%2C-14.473%208.002%2C0%2014.479%2C6.479%2014.479%2C14.473%200%2C7.994%20-6.477%2C14.479%20-14.479%2C14.479%20C%206.477%2C14.479%200%2C7.994%200%2C0%22%0A%20%20%20%20%20%20%20%20%20style%3D%22fill%3A%23414042%3Bfill-opacity%3A1%3Bfill-rule%3Anonzero%3Bstroke%3Anone%3Bstroke-width%3A0.320312%22%0A%20%20%20%20%20%20%20%20%20id%3D%22path108-9%22%0A%20%20%20%20%20%20%20%20%20inkscape%3Aconnector-curvature%3D%220%22%20%2F%3E%0A%20%20%20%20%3C%2Fg%3E%0A%20%20%3C%2Fg%3E%0A%3C%2Fsvg%3E%0A";

//#endregion
//#region \0godot-css:D:/projects/dsh-godot/ui-godot/src/client/debug/DebugCard.module.css.mjs
const css$5 = "/* The row belongs to the shell's DisclosureRow; this file styles what the card\r\n   puts inside it. */\r\n/* The separator the shell rows draw between a title and its summary: a 2 px dot.\r\n   `collapsedContent` renders inside a text span, so the dot is inline-block. */\r\n.godot_DebugCard_module_css_sep {\r\n  display: inline-block;\r\n  width: 2px;\r\n  height: 2px;\r\n  border-radius: 1px;\r\n  margin: 0 8px;\r\n  vertical-align: middle;\r\n  background: var(--dsw-alias-label-caption);\r\n}\r\n\r\n\r\n/* A failed run reads as a failure in the row's own title. */\r\n.godot_DebugCard_module_css_failed {\r\n  color: var(--dsw-alias-label-danger);\r\n}\r\n\r\n/* The run's facts sit at the row's secondary size, the way every shell row's summary\r\n   does: the content variable, not a fixed token, so a reader's font scale still\r\n   applies. Without this the span inherits the primary content size and reads one step\r\n   larger than the title beside it. */\r\n.godot_DebugCard_module_css_facts {\r\n  font-size: var(--dsh-content-font-size-secondary, 13px);\r\n  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));\r\n  color: var(--dsw-alias-label-tertiary);\r\n  min-width: 0;\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n}\r\n\r\n/* The mark is masked, so it takes the shape of the row's own leading icon slot:\r\n   14 px, `currentColor`, replaced by the chevron on hover. */\r\n.godot_DebugCard_module_css_icon {\r\n  display: block;\r\n  width: 14px;\r\n  height: 14px;\r\n  flex: none;\r\n  background-color: currentColor;\r\n  mask-repeat: no-repeat;\r\n  mask-position: center;\r\n  mask-size: contain;\r\n}\r\n\r\n/* The failure branch has no host row to style it. */\r\n.godot_DebugCard_module_css_name {\r\n  font: var(--dsw-font-xs-13);\r\n  color: var(--dsw-alias-label-primary);\r\n}\r\n\r\n/* The body rides the secondary tier the row title and the summary use (ToolDetails\r\n   sets `font: xs-13` on its own body): with no size here the content inherits the\r\n   message's primary size and reads one step over the row it sits under. The card\r\n   sits on the row's own indent; the sections inside it need none. */\r\n.godot_DebugCard_module_css_bodyWrap {\r\n  font-size: var(--dsh-content-font-size-secondary, 13px);\r\n  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));\r\n  margin: 8px 0 0 20px;\r\n  padding: 10px 14px;\r\n  border-radius: var(--dsw-radius-lg);\r\n  background: var(--dsw-alias-markdown-code-block);\r\n}\r\n\r\n.godot_DebugCard_module_css_stops {\r\n  display: grid;\r\n  gap: 6px;\r\n}\r\n\r\n/* Sections divide by a hairline on the card's own surface — no nested boxes. */\r\n.godot_DebugCard_module_css_stop {\r\n  border-top: 1px solid var(--dsw-alias-border-l2);\r\n  padding-top: 6px;\r\n  margin-top: 6px;\r\n}\r\n\r\n/* The first stop has no rule above it: the card's own edge is there. */\r\n.godot_DebugCard_module_css_stops > .godot_DebugCard_module_css_stop:first-child,\r\n.godot_DebugCard_module_css_bodyWrap > .godot_DebugCard_module_css_stops > .godot_DebugCard_module_css_stop:first-child {\r\n  border-top: 0;\r\n  margin-top: 0;\r\n  padding-top: 0;\r\n}\r\n\r\n.godot_DebugCard_module_css_stopHead {\r\n  display: flex;\r\n  gap: 10px;\r\n  align-items: baseline;\r\n  cursor: pointer;\r\n  flex-wrap: wrap;\r\n}\r\n\r\n.godot_DebugCard_module_css_stopIndex {\r\n  font: var(--dsw-font-xs-13-strong);\r\n  color: var(--dsw-alias-label-primary);\r\n}\r\n\r\n.godot_DebugCard_module_css_stopWhere {\r\n  font-family: var(--dsw-font-family-mono);\r\n  color: var(--dsw-alias-label-primary);\r\n}\r\n\r\n.godot_DebugCard_module_css_stopReason {\r\n  color: var(--dsw-alias-label-tertiary);\r\n}\r\n\r\n.godot_DebugCard_module_css_stopThread {\r\n  margin-left: auto;\r\n  color: var(--dsw-alias-label-tertiary);\r\n}\r\n\r\n.godot_DebugCard_module_css_section {\r\n  margin-top: 6px;\r\n}\r\n\r\n.godot_DebugCard_module_css_sectionTitle {\r\n  margin: 0 0 4px;\r\n  font: var(--dsw-font-xs-13-strong);\r\n  color: var(--dsw-alias-label-tertiary);\r\n}\r\n\r\n.godot_DebugCard_module_css_frames {\r\n  margin: 0;\r\n  padding-left: 18px;\r\n  font-family: var(--dsw-font-family-mono);\r\n}\r\n\r\n/* Text sits on the card's own surface — the shell's code blocks draw no inner box. */\r\n.godot_DebugCard_module_css_block {\r\n  margin: 4px 0 0;\r\n  font-family: var(--dsw-font-family-mono);\r\n  white-space: pre-wrap;\r\n  overflow-x: auto;\r\n  max-height: 320px;\r\n}\r\n\r\n.godot_DebugCard_module_css_entries {\r\n  margin: 4px 0 0;\r\n  padding: 0;\r\n  list-style: none;\r\n}\r\n\r\n.godot_DebugCard_module_css_entry {\r\n  margin: 2px 0;\r\n}\r\n\r\n.godot_DebugCard_module_css_entryHead {\r\n  display: flex;\r\n  gap: 8px;\r\n  align-items: baseline;\r\n}\r\n\r\n.godot_DebugCard_module_css_rows {\r\n  margin: 2px 0 0;\r\n  padding-left: 16px;\r\n  list-style: none;\r\n}\r\n\r\n.godot_DebugCard_module_css_rowName {\r\n  color: var(--dsw-alias-label-tertiary);\r\n  margin-right: 8px;\r\n}\r\n\r\n.godot_DebugCard_module_css_rowValue {\r\n  font-family: var(--dsw-font-family-mono);\r\n  color: var(--dsw-alias-label-primary);\r\n}\r\n\r\n.godot_DebugCard_module_css_dim {\r\n  color: var(--dsw-alias-label-tertiary);\r\n}\r\n\r\n/* The picked node of a stop: identity first, then whatever the run expanded. */\r\n.godot_DebugCard_module_css_nodeInfo {\r\n  margin-top: 6px;\r\n  padding: 6px 8px;\r\n  border-radius: 4px;\r\n  background: var(--dsw-alias-bg-layer-2);\r\n}\r\n\r\n.godot_DebugCard_module_css_nodeHead {\r\n  display: flex;\r\n  gap: 8px;\r\n  align-items: baseline;\r\n  flex-wrap: wrap;\r\n  color: var(--dsw-alias-label-primary);\r\n  font: var(--dsw-font-xs-13);\r\n}\r\n\r\n.godot_DebugCard_module_css_ok {\r\n  color: var(--dsw-alias-label-positive);\r\n}\r\n\r\n.godot_DebugCard_module_css_bad {\r\n  color: var(--dsw-alias-label-danger);\r\n}\r\n\r\n.godot_DebugCard_module_css_exit {\r\n  margin-top: 6px;\r\n  color: var(--dsw-alias-label-tertiary);\r\n}\r\n\r\n/* The shell's own inspect action, in the place the built-in rows put theirs. */\r\n.godot_DebugCard_module_css_inspect {\r\n  display: inline-flex;\r\n  align-items: center;\r\n  gap: 4px;\r\n  margin-top: 8px;\r\n  padding: 2px 8px;\r\n  border: 1px solid var(--dsw-alias-border-l2);\r\n  border-radius: var(--dsw-radius-sm);\r\n  background: none;\r\n  color: var(--dsw-alias-label-secondary);\r\n  font: var(--dsw-font-xs-13);\r\n  cursor: pointer;\r\n}\r\n\r\n@media (hover: hover) {\r\n  .godot_DebugCard_module_css_inspect:hover {\r\n    background: var(--dsw-alias-interactive-bg-hover);\r\n    color: var(--dsw-alias-label-primary);\r\n  }\r\n}\r\n";
const tag$5 = "ui-godot:DebugCard.module.css";
if (typeof document !== "undefined" && document.getElementById(tag$5) === null) {
	const style = document.createElement("style");
	style.id = tag$5;
	style.dataset.plugin = "ui-godot";
	style.textContent = css$5;
	document.head.appendChild(style);
}
var DebugCard_module_css_default = {
	"sep": "godot_DebugCard_module_css_sep",
	"failed": "godot_DebugCard_module_css_failed",
	"facts": "godot_DebugCard_module_css_facts",
	"icon": "godot_DebugCard_module_css_icon",
	"name": "godot_DebugCard_module_css_name",
	"bodyWrap": "godot_DebugCard_module_css_bodyWrap",
	"stops": "godot_DebugCard_module_css_stops",
	"stop": "godot_DebugCard_module_css_stop",
	"stopHead": "godot_DebugCard_module_css_stopHead",
	"stopIndex": "godot_DebugCard_module_css_stopIndex",
	"stopWhere": "godot_DebugCard_module_css_stopWhere",
	"stopReason": "godot_DebugCard_module_css_stopReason",
	"stopThread": "godot_DebugCard_module_css_stopThread",
	"section": "godot_DebugCard_module_css_section",
	"sectionTitle": "godot_DebugCard_module_css_sectionTitle",
	"frames": "godot_DebugCard_module_css_frames",
	"block": "godot_DebugCard_module_css_block",
	"entries": "godot_DebugCard_module_css_entries",
	"entry": "godot_DebugCard_module_css_entry",
	"entryHead": "godot_DebugCard_module_css_entryHead",
	"rows": "godot_DebugCard_module_css_rows",
	"rowName": "godot_DebugCard_module_css_rowName",
	"rowValue": "godot_DebugCard_module_css_rowValue",
	"dim": "godot_DebugCard_module_css_dim",
	"nodeInfo": "godot_DebugCard_module_css_nodeInfo",
	"nodeHead": "godot_DebugCard_module_css_nodeHead",
	"ok": "godot_DebugCard_module_css_ok",
	"bad": "godot_DebugCard_module_css_bad",
	"exit": "godot_DebugCard_module_css_exit",
	"inspect": "godot_DebugCard_module_css_inspect"
};

//#endregion
//#region src/client/scene/icons.ts
/**
* The engine classes the packaged icon set covers.
*
* Generated from `src/client/assets/icons/`: one SVG per engine class, named
* after the class. The build copies that directory to `lib/assets/icons` (the
* host serves it under `/plugins/<package>/assets/`), so the list and the files
* cannot drift without a build change. The tree uses an icon as a CSS mask, so
* the file's own colours never matter — only its shape — and a class outside
* this set falls back to a dot instead of a mask that fails to load.
*/
/** Class names with a packaged icon. */
const NODE_ICON_CLASSES = new Set([
	"ARVRAnchor",
	"ARVRCamera",
	"ARVRController",
	"ARVROrigin",
	"AcceptDialog",
	"AnimatableBody2D",
	"AnimatableBody3D",
	"AnimatedSprite",
	"AnimatedSprite2D",
	"AnimatedSprite3D",
	"AnimatedTexture",
	"Animation",
	"AnimationLibrary",
	"AnimationPlayer",
	"AnimationTree",
	"AnimationTreePlayer",
	"Area",
	"Area2D",
	"Area3D",
	"ArrayMesh",
	"ArrayOccluder3D",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"ArrowUp",
	"AspectRatioContainer",
	"AtlasTexture",
	"AudioListener2D",
	"AudioListener3D",
	"AudioStreamPlayer",
	"AudioStreamPlayer2D",
	"AudioStreamPlayer3D",
	"AudioStreamPolyphonic",
	"AudioStreamSample",
	"AudioStreamWAV",
	"BackBufferCopy",
	"BakedLightmap",
	"BakedLightmapData",
	"BitMap",
	"BitmapFont",
	"Bone2D",
	"BoneAttachment",
	"BoneAttachment3D",
	"BoxContainer",
	"BoxMesh",
	"BoxOccluder3D",
	"BoxShape",
	"BoxShape3D",
	"Button",
	"ButtonGroup",
	"CPUParticles",
	"CPUParticles2D",
	"CPUParticles3D",
	"CSGBox",
	"CSGBox3D",
	"CSGCombiner",
	"CSGCombiner3D",
	"CSGCylinder",
	"CSGCylinder3D",
	"CSGMesh",
	"CSGMesh3D",
	"CSGPolygon",
	"CSGPolygon3D",
	"CSGSphere",
	"CSGSphere3D",
	"CSGTorus",
	"CSGTorus3D",
	"CSharpScript",
	"Camera",
	"Camera2D",
	"Camera3D",
	"CameraAttributesPhysical",
	"CameraAttributesPractical",
	"CameraTexture",
	"CanvasGroup",
	"CanvasItemMaterial",
	"CanvasLayer",
	"CanvasModulate",
	"CanvasTexture",
	"CapsuleMesh",
	"CapsuleShape",
	"CapsuleShape2D",
	"CapsuleShape3D",
	"CenterContainer",
	"CharacterBody2D",
	"CharacterBody3D",
	"CheckBox",
	"CheckButton",
	"CircleShape2D",
	"ClippedCamera",
	"CodeEdit",
	"CodeHighlighter",
	"CollisionPolygon",
	"CollisionPolygon2D",
	"CollisionPolygon3D",
	"CollisionShape",
	"CollisionShape2D",
	"CollisionShape3D",
	"ColorPicker",
	"ColorPickerButton",
	"ColorRect",
	"CompressedTexture2D",
	"CompressedTexture3D",
	"ConcavePolygonShape",
	"ConcavePolygonShape2D",
	"ConcavePolygonShape3D",
	"ConeTwistJoint",
	"ConeTwistJoint3D",
	"ConfirmationDialog",
	"Container",
	"Control",
	"ConvexPolygonShape",
	"ConvexPolygonShape2D",
	"ConvexPolygonShape3D",
	"CubeMap",
	"CubeMesh",
	"CubemapArray",
	"Curve",
	"Curve2D",
	"Curve3D",
	"CurveTexture",
	"CurveXYZTexture",
	"CylinderMesh",
	"CylinderShape",
	"CylinderShape3D",
	"DampedSpringJoint2D",
	"Decal",
	"DirectionalLight",
	"DirectionalLight2D",
	"DirectionalLight3D",
	"DynamicFont",
	"DynamicFontData",
	"Edit",
	"Environment",
	"FileDialog",
	"FlowContainer",
	"FogMaterial",
	"FogVolume",
	"FontFile",
	"FontVariation",
	"GDNativeLibrary",
	"GDScript",
	"GIProbe",
	"GIProbeData",
	"GPUParticles2D",
	"GPUParticles3D",
	"GPUParticlesAttractorBox3D",
	"GPUParticlesAttractorSphere3D",
	"GPUParticlesAttractorVectorField3D",
	"GPUParticlesCollisionBox3D",
	"GPUParticlesCollisionHeightField3D",
	"GPUParticlesCollisionSDF3D",
	"GPUParticlesCollisionSphere3D",
	"Generic6DOFJoint",
	"Generic6DOFJoint3D",
	"Gradient",
	"GradientTexture",
	"GradientTexture1D",
	"GradientTexture2D",
	"GraphEdit",
	"GraphElement",
	"GraphFrame",
	"GraphNode",
	"GridContainer",
	"GridMap",
	"GrooveJoint2D",
	"GuiVisibilityHidden",
	"GuiVisibilityVisible",
	"GuiVisibilityXray",
	"HBoxContainer",
	"HFlowContainer",
	"HScrollBar",
	"HSeparator",
	"HSlider",
	"HSplitContainer",
	"HTTPRequest",
	"HeightMapShape",
	"HeightMapShape3D",
	"Help",
	"HelpSearch",
	"HingeJoint",
	"HingeJoint3D",
	"ImageTexture",
	"ImageTexture3D",
	"ImmediateGeometry",
	"ImmediateMesh",
	"ImportCheck",
	"ImportFail",
	"ImporterMeshInstance3D",
	"Info",
	"InterpolatedCamera",
	"ItemList",
	"KinematicBody",
	"LOD",
	"Label",
	"Label3D",
	"LabelSettings",
	"LargeTexture",
	"LightOccluder2D",
	"LightmapGI",
	"LightmapGIData",
	"LightmapProbe",
	"Line2D",
	"LineEdit",
	"LinkButton",
	"Listener",
	"Lock",
	"MarginContainer",
	"Marker2D",
	"Marker3D",
	"MenuBar",
	"MenuButton",
	"MergeGroup",
	"MeshInstance",
	"MeshInstance2D",
	"MeshInstance3D",
	"MeshLibrary",
	"MeshTexture",
	"MultiMesh",
	"MultiMeshInstance",
	"MultiMeshInstance2D",
	"MultiMeshInstance3D",
	"Navigation",
	"NavigationAgent",
	"NavigationAgent2D",
	"NavigationAgent3D",
	"NavigationLink2D",
	"NavigationLink3D",
	"NavigationMesh",
	"NavigationMeshInstance",
	"NavigationObstacle",
	"NavigationObstacle2D",
	"NavigationObstacle3D",
	"NavigationPolygon",
	"NavigationPolygonInstance",
	"NavigationRegion2D",
	"NavigationRegion3D",
	"NinePatchRect",
	"Node",
	"Node2D",
	"Node3D",
	"NoiseTexture",
	"NoiseTexture2D",
	"NoiseTexture3D",
	"ORMMaterial3D",
	"ORMSpatialMaterial",
	"Object",
	"Occluder",
	"OccluderInstance3D",
	"OccluderPolygon2D",
	"OccluderShapePolygon",
	"OccluderShapeSphere",
	"OmniLight",
	"OmniLight3D",
	"OptionButton",
	"PackedScene",
	"Panel",
	"PanelContainer",
	"PanoramaSky",
	"PanoramaSkyMaterial",
	"Parallax2D",
	"ParallaxBackground",
	"ParallaxLayer",
	"ParticleProcessMaterial",
	"Particles",
	"ParticlesMaterial",
	"Path",
	"Path2D",
	"Path3D",
	"PathFollow",
	"PathFollow2D",
	"PathFollow3D",
	"PhysicalBone",
	"PhysicalBone2D",
	"PhysicalBone3D",
	"PhysicalBoneSimulator3D",
	"PhysicalSkyMaterial",
	"PhysicsMaterial",
	"PinJoint",
	"PinJoint2D",
	"PinJoint3D",
	"PlaceholderMaterial",
	"PlaceholderMesh",
	"PlaceholderTexture2D",
	"PlaceholderTexture3D",
	"PlaneMesh",
	"PlaneShape",
	"Play",
	"PlayBackwards",
	"PlayCustom",
	"PlayRemote",
	"PlayScene",
	"PlayStart",
	"PointLight2D",
	"PointMesh",
	"Polygon2D",
	"PolygonOccluder3D",
	"PolygonPathFinder",
	"Popup",
	"PopupDialog",
	"PopupMenu",
	"PopupPanel",
	"PortableCompressedTexture2D",
	"Portal",
	"PrismMesh",
	"ProceduralSky",
	"ProceduralSkyMaterial",
	"Progress1",
	"Progress2",
	"Progress3",
	"Progress4",
	"Progress5",
	"Progress6",
	"Progress7",
	"Progress8",
	"ProgressBar",
	"ProximityGroup",
	"ProxyTexture",
	"QuadMesh",
	"QuadOccluder3D",
	"RayCast",
	"RayCast2D",
	"RayCast3D",
	"RayShape",
	"RectangleShape2D",
	"ReferenceRect",
	"ReflectionProbe",
	"RegEx",
	"RegExMatch",
	"Reload",
	"ReloadSmall",
	"RemoteTransform",
	"RemoteTransform2D",
	"RemoteTransform3D",
	"ResourcePreloader",
	"RibbonTrailMesh",
	"RichTextEffect",
	"RichTextLabel",
	"RigidBody",
	"RigidBody2D",
	"RigidBody3D",
	"Room",
	"RoomGroup",
	"RoomManager",
	"RootMotionView",
	"Script",
	"ScriptCreate",
	"ScriptRemove",
	"ScrollContainer",
	"Search",
	"SegmentShape2D",
	"SeparationRayShape2D",
	"SeparationRayShape3D",
	"Shader",
	"ShaderGlobalsOverride",
	"ShaderInclude",
	"ShaderMaterial",
	"ShapeCast",
	"ShapeCast2D",
	"ShapeCast3D",
	"ShortCut",
	"Signals",
	"SignalsAndGroups",
	"Skeleton",
	"Skeleton2D",
	"Skeleton3D",
	"SkeletonIK",
	"SkeletonIK3D",
	"Sky",
	"SliderJoint",
	"SliderJoint3D",
	"Slot",
	"SoftBody",
	"SoftBody3D",
	"Spatial",
	"SpatialMaterial",
	"SphereMesh",
	"SphereOccluder3D",
	"SphereShape",
	"SphereShape3D",
	"SpinBox",
	"SplitContainer",
	"SpotLight",
	"SpotLight3D",
	"SpringArm",
	"SpringArm3D",
	"Sprite",
	"Sprite2D",
	"Sprite3D",
	"SpriteFrames",
	"StandardMaterial3D",
	"StaticBody",
	"StaticBody2D",
	"StaticBody3D",
	"StatusIndicator",
	"Stop",
	"StreamTexture",
	"StyleBoxEmpty",
	"StyleBoxFlat",
	"StyleBoxLine",
	"StyleBoxTexture",
	"SubViewport",
	"SubViewportContainer",
	"SyntaxHighlighter",
	"SystemFont",
	"TabBar",
	"TabContainer",
	"Tabs",
	"TextEdit",
	"TextFile",
	"TextMesh",
	"Texture2DArray",
	"Texture3D",
	"TextureArray",
	"TextureButton",
	"TextureProgress",
	"TextureProgressBar",
	"TextureRect",
	"Theme",
	"TileMap",
	"TileMapLayer",
	"TileSet",
	"Timer",
	"ToolButton",
	"TorusMesh",
	"TouchScreenButton",
	"Tree",
	"TubeTrailMesh",
	"Tween",
	"Unlock",
	"VBoxContainer",
	"VFlowContainer",
	"VScrollBar",
	"VSeparator",
	"VSlider",
	"VSplitContainer",
	"VehicleBody",
	"VehicleBody3D",
	"VehicleWheel",
	"VehicleWheel3D",
	"VideoPlayer",
	"VideoStreamPlayer",
	"Viewport",
	"ViewportContainer",
	"ViewportTexture",
	"VisibilityEnabler",
	"VisibilityNotifier",
	"VisibleOnScreenEnabler2D",
	"VisibleOnScreenEnabler3D",
	"VisibleOnScreenNotifier2D",
	"VisibleOnScreenNotifier3D",
	"VisualScript",
	"VisualScriptComment",
	"VisualScriptExpression",
	"VisualShader",
	"VisualShaderNodeBooleanUniform",
	"VisualShaderNodeColorConstant",
	"VisualShaderNodeColorOp",
	"VisualShaderNodeColorUniform",
	"VisualShaderNodeComment",
	"VisualShaderNodeCubeMap",
	"VisualShaderNodeCubeMapUniform",
	"VisualShaderNodeCurveTexture",
	"VisualShaderNodeCurveXYZTexture",
	"VisualShaderNodeExpression",
	"VisualShaderNodeFloatFunc",
	"VisualShaderNodeFloatOp",
	"VisualShaderNodeGlobalExpression",
	"VisualShaderNodeInput",
	"VisualShaderNodeIntFunc",
	"VisualShaderNodeIntOp",
	"VisualShaderNodeScalarFunc",
	"VisualShaderNodeScalarOp",
	"VisualShaderNodeScalarUniform",
	"VisualShaderNodeTextureUniform",
	"VisualShaderNodeTextureUniformTriplanar",
	"VisualShaderNodeTransformCompose",
	"VisualShaderNodeTransformDecompose",
	"VisualShaderNodeTransformUniform",
	"VisualShaderNodeTransformVecMult",
	"VisualShaderNodeVec3Uniform",
	"VisualShaderNodeVectorCompose",
	"VisualShaderNodeVectorDecompose",
	"VisualShaderNodeVectorDistance",
	"VisualShaderNodeVectorFunc",
	"VisualShaderNodeVectorLen",
	"VoxelGI",
	"VoxelGIData",
	"Window",
	"WindowDialog",
	"World",
	"World2D",
	"World3D",
	"WorldBoundaryShape2D",
	"WorldBoundaryShape3D",
	"WorldEnvironment",
	"XRAnchor3D",
	"XRBodyModifier3D",
	"XRCamera3D",
	"XRController3D",
	"XRFaceModifier3D",
	"XRHandModifier3D",
	"XRNode3D",
	"XROrigin3D",
	"YSort",
	"Zoom",
	"ZoomLess",
	"ZoomMore",
	"ZoomReset"
]);

//#endregion
//#region \0godot-css:D:/projects/dsh-godot/ui-godot/src/client/scene/NodeTree.module.css.mjs
const css$4 = "/* One scene tree: rows, icons and the editor's marks. */\r\n\r\n.godot_NodeTree_module_css_tree {\r\n  margin: 0;\r\n  padding: 8px 4px 8px 8px;\r\n  list-style: none;\r\n  /* A row ellipsises its own text; the tree must not scroll sideways for it. */\r\n  overflow-x: hidden;\r\n  overflow-y: auto;\r\n}\r\n\r\n.godot_NodeTree_module_css_children {\r\n  margin: 0;\r\n  padding-left: 11px;\r\n  list-style: none;\r\n}\r\n\r\n.godot_NodeTree_module_css_node {\r\n  margin: 1px 0;\r\n}\r\n\r\n.godot_NodeTree_module_css_row {\r\n  display: flex;\r\n  align-items: baseline;\r\n  gap: 6px;\r\n  border-radius: 4px;\r\n  padding: 1px 4px;\r\n  min-width: 0;\r\n}\r\n\r\n/* Selection draws a ring, not a fill: the fill channel reports captured state\r\n   (the row's own properties are in this run's sample), so the two never compete. */\r\n.godot_NodeTree_module_css_rowSelected {\r\n  box-shadow: inset 0 0 0 1px var(--dsw-alias-label-tertiary);\r\n}\r\n\r\n/* A marked row: the same green a diff addition uses, at 8% so it reads as a state\r\n   rather than a highlight. The debug card marks the rows whose properties it\r\n   sampled; the state card marks the rows this read changed. */\r\n.godot_NodeTree_module_css_rowMarked {\r\n  background: var(--dsw-static-green-500-a08);\r\n}\r\n\r\n.godot_NodeTree_module_css_rowMarked.godot_NodeTree_module_css_rowSelected {\r\n  background: var(--dsw-static-green-500-a12);\r\n}\r\n\r\n.godot_NodeTree_module_css_twisty,\r\n.godot_NodeTree_module_css_twistySpacer {\r\n  width: 14px;\r\n  flex: none;\r\n  color: var(--dsw-alias-label-tertiary);\r\n  background: none;\r\n  border: 0;\r\n  padding: 0;\r\n  cursor: pointer;\r\n  font: inherit;\r\n}\r\n\r\n/* The name keeps its width; the class text is what gives way when the pane is\r\n   narrow, so a row never reads as `Cell_00…`. */\r\n.godot_NodeTree_module_css_name {\r\n  flex: 0 1 auto;\r\n  min-width: 8ch;\r\n  background: none;\r\n  border: 0;\r\n  padding: 0;\r\n  cursor: pointer;\r\n  color: var(--dsw-alias-label-primary);\r\n  font: inherit;\r\n  text-align: left;\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n}\r\n\r\n.godot_NodeTree_module_css_icon {\r\n  width: 14px;\r\n  height: 14px;\r\n  flex: none;\r\n  align-self: center;\r\n}\r\n\r\n/* A class outside the icon set keeps the row aligned without inventing a mark. */\r\n.godot_NodeTree_module_css_iconSpacer {\r\n  width: 14px;\r\n  height: 14px;\r\n  flex: none;\r\n}\r\n\r\n/* Icons are masks: the file supplies the shape, the row supplies the colour,\r\n   so one packaged set reads correctly in either theme. */\r\n.godot_NodeTree_module_css_icon,\r\n.godot_NodeTree_module_css_badgeIcon {\r\n  mask-repeat: no-repeat;\r\n  mask-position: center;\r\n  mask-size: contain;\r\n}\r\n\r\n/* The script and inherited-scene glyphs ride beside the class icon at a\r\n   smaller size, reading as attributes of the node rather than of the class. */\r\n.godot_NodeTree_module_css_badgeIcon {\r\n  width: 12px;\r\n  height: 12px;\r\n  flex: none;\r\n  align-self: center;\r\n  background-color: var(--dsw-alias-label-tertiary);\r\n}\r\n\r\n.godot_NodeTree_module_css_icon {\r\n  background-color: var(--dsw-alias-label-secondary);\r\n}\r\n\r\n.godot_NodeTree_module_css_type {\r\n  flex: 1 1 auto;\r\n  min-width: 0;\r\n  color: var(--dsw-alias-label-tertiary);\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n}\r\n\r\n/* Marks sit in a right-aligned block, the way the Godot editor's Scene dock\r\n   places them before its visibility toggle: `%` for a unique name, then the\r\n   script glyph for a script. VSCode had to spell the script mark as the letter\r\n   `S` because a file-decoration badge holds one character; a tree can draw the\r\n   icon instead. */\r\n.godot_NodeTree_module_css_marks {\r\n  margin-left: auto;\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 4px;\r\n  flex: none;\r\n}\r\n\r\n.godot_NodeTree_module_css_uniqueMark {\r\n  font: var(--dsw-font-xs-13);\r\n  color: var(--dsw-alias-label-tertiary);\r\n}\r\n\r\n.godot_NodeTree_module_css_badge {\r\n  border: 1px solid var(--dsw-alias-border-l2);\r\n  border-radius: 999px;\r\n  padding: 0 6px;\r\n  font-size: 10px;\r\n  color: var(--dsw-alias-label-tertiary);\r\n  flex: none;\r\n}\r\n\r\n.godot_NodeTree_module_css_line {\r\n  color: var(--dsw-alias-label-tertiary);\r\n  font-size: 10px;\r\n  flex: none;\r\n  min-width: 18px;\r\n  text-align: right;\r\n}\r\n";
const tag$4 = "ui-godot:NodeTree.module.css";
if (typeof document !== "undefined" && document.getElementById(tag$4) === null) {
	const style = document.createElement("style");
	style.id = tag$4;
	style.dataset.plugin = "ui-godot";
	style.textContent = css$4;
	document.head.appendChild(style);
}
var NodeTree_module_css_default = {
	"tree": "godot_NodeTree_module_css_tree",
	"children": "godot_NodeTree_module_css_children",
	"node": "godot_NodeTree_module_css_node",
	"row": "godot_NodeTree_module_css_row",
	"rowSelected": "godot_NodeTree_module_css_rowSelected",
	"rowMarked": "godot_NodeTree_module_css_rowMarked",
	"twisty": "godot_NodeTree_module_css_twisty",
	"twistySpacer": "godot_NodeTree_module_css_twistySpacer",
	"name": "godot_NodeTree_module_css_name",
	"icon": "godot_NodeTree_module_css_icon",
	"iconSpacer": "godot_NodeTree_module_css_iconSpacer",
	"badgeIcon": "godot_NodeTree_module_css_badgeIcon",
	"type": "godot_NodeTree_module_css_type",
	"marks": "godot_NodeTree_module_css_marks",
	"uniqueMark": "godot_NodeTree_module_css_uniqueMark",
	"badge": "godot_NodeTree_module_css_badge",
	"line": "godot_NodeTree_module_css_line"
};

//#endregion
//#region src/client/scene/NodeTree.tsx
/** Package name, used to build document-relative asset URLs. */
const PACKAGE = "@deepseek-ai/dsh-ui-godot";
/**
* The icon URL for one engine class.
*/
function iconUrl(className) {
	return NODE_ICON_CLASSES.has(className) ? `plugins/${PACKAGE}/assets/icons/${encodeURIComponent(className)}.svg` : void 0;
}
/** The script glyph the editor draws for a scripted node. */
function scriptGlyphUrl() {
	return `plugins/${PACKAGE}/assets/icons/Script.svg`;
}
/** One node row and its children. */
function Row(props) {
	const { node, selected, onSelect, t, openKeys } = props;
	const [open, setOpen] = (0, react.useState)(openKeys.has(node.key) || openKeys.size === 0);
	const hasChildren = node.children.length > 0;
	const icon = iconUrl(node.iconClass);
	const instanceGlyph = node.instance === void 0 ? void 0 : iconUrl("PackedScene");
	const rowClass = [
		NodeTree_module_css_default.row,
		node.marked === true ? NodeTree_module_css_default.rowMarked : "",
		selected === node.key ? NodeTree_module_css_default.rowSelected : ""
	].filter((part) => part !== "").join(" ");
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
		className: NodeTree_module_css_default.node,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: rowClass,
			title: node.title,
			children: [
				hasChildren ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: NodeTree_module_css_default.twisty,
					"aria-label": open ? t.sceneCollapse : t.sceneExpand,
					"aria-expanded": open,
					onClick: () => {
						setOpen(!open);
					},
					children: open ? "▾" : "▸"
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: NodeTree_module_css_default.twistySpacer }),
				icon === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: NodeTree_module_css_default.iconSpacer,
					"aria-hidden": "true"
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: NodeTree_module_css_default.icon,
					style: { maskImage: `url("${icon}")` },
					"aria-hidden": "true"
				}),
				onSelect === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: NodeTree_module_css_default.name,
					children: node.name
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: NodeTree_module_css_default.name,
					onClick: () => {
						onSelect(node);
					},
					children: node.name
				}),
				node.subtitle !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: NodeTree_module_css_default.type,
					children: node.subtitle
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: NodeTree_module_css_default.marks,
					children: [
						instanceGlyph !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: NodeTree_module_css_default.badgeIcon,
							style: { maskImage: `url("${instanceGlyph}")` },
							title: `${t.sceneInstance}: ${node.instance ?? ""}`
						}),
						node.unique === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: NodeTree_module_css_default.uniqueMark,
							title: t.sceneUnique,
							children: "%"
						}),
						node.script !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: NodeTree_module_css_default.badgeIcon,
							style: { maskImage: `url("${scriptGlyphUrl()}")` },
							title: `${t.sceneScript}: ${node.script}`
						}),
						node.line !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: NodeTree_module_css_default.line,
							children: node.line
						})
					]
				})
			]
		}), hasChildren && open && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
			className: NodeTree_module_css_default.children,
			children: node.children.map((child) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
				node: child,
				selected,
				onSelect,
				t,
				openKeys
			}, child.key))
		})]
	});
}
/** Render a node hierarchy; `openKeys` rows start unfolded (empty = all unfolded). */
function NodeTree(props) {
	const openKeys = props.openKeys ?? /* @__PURE__ */ new Set();
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
		className: NodeTree_module_css_default.tree,
		children: props.roots.map((root) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
			node: root,
			selected: props.selected,
			onSelect: props.onSelect,
			t: props.t,
			openKeys
		}, root.key))
	});
}

//#endregion
//#region src/client/cards/fold.ts
const OPEN_CALLS = /* @__PURE__ */ new Set();
/** One card's fold state, stored per call rather than per component instance. */
function useCardFold(callId) {
	const [, bump] = (0, react.useState)(0);
	const write = (open) => {
		if (open) OPEN_CALLS.add(callId);
		else OPEN_CALLS.delete(callId);
		bump((count) => count + 1);
	};
	return {
		expanded: OPEN_CALLS.has(callId),
		toggle: () => {
			write(!OPEN_CALLS.has(callId));
		}
	};
}

//#endregion
//#region src/client/debug/debug-view.ts
/**
* Whether a value can be treated as a card view.
*
* The view crosses the tool-result boundary as plain JSON, so every array the
* renderer iterates is checked here once: a malformed entry is dropped rather
* than allowed to throw during render (a crashing toolview entry is abdicated
* for the rest of the session by the slot registry).
*/
function asDebugView(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const view = value;
	if (!Array.isArray(view.stops)) return void 0;
	const stops = view.stops.filter((stop) => typeof stop === "object" && stop !== null && typeof stop.index === "number").map((stop) => {
		const { sceneTree,...rest$1 } = stop;
		return {
			...rest$1,
			frames: Array.isArray(rest$1.frames) ? rest$1.frames : [],
			varsLines: Array.isArray(rest$1.varsLines) ? rest$1.varsLines : void 0,
			...Array.isArray(sceneTree?.nodes) ? { sceneTree } : {}
		};
	});
	const expansion = isRecord(view.expansion) && Array.isArray(view.expansion.entries) ? view.expansion : void 0;
	const edits = isRecord(view.edits) && Array.isArray(view.edits.results) ? view.edits : void 0;
	const { expansion: _rawExpansion, edits: _rawEdits,...rest } = view;
	return {
		...rest,
		stops,
		outputTail: Array.isArray(view.outputTail) ? view.outputTail : [],
		errors: Array.isArray(view.errors) ? view.errors : [],
		...expansion === void 0 ? {} : { expansion },
		...edits === void 0 ? {} : { edits }
	};
}
function isRecord(value) {
	return typeof value === "object" && value !== null;
}
/** The rows of an expanded entry; an absent or malformed list is empty. */
function entryRows(entry) {
	return Array.isArray(entry.rows) ? entry.rows : [];
}
/** The nested entries of an expanded object; an absent or malformed list is empty. */
function entryChildren(entry) {
	return Array.isArray(entry.children) ? entry.children : [];
}
/** Parse the call's arguments defensively; an unparsable argument bag is empty. */
function callArgs(block) {
	const raw = block === void 0 ? void 0 : block.call?.argsRaw ?? block.argsRaw;
	if (typeof raw !== "string" || raw === "") return {};
	try {
		const parsed = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}
/** The text a failed or view-less call rendered, joined. */
function callText(block) {
	if (block === void 0) return "";
	const blocks = Array.isArray(block.content) ? block.content : [];
	const parts = [];
	for (const item of blocks) if (typeof item === "object" && item !== null && item.type === "text" && typeof item.text === "string") parts.push(item.text);
	return parts.join("\n");
}

//#endregion
//#region src/client/debug/DebugCard.tsx
/** Rows shown per object before the card says how many it held back. */
const ROW_LIMIT = 12;
/** The tree's labels, from the card's own namespace. */
function treeLocale$1(t) {
	return {
		sceneScript: t("sceneScript"),
		sceneInstance: t("sceneInstance"),
		sceneUnique: t("sceneUnique"),
		sceneCollapse: t("sceneCollapse"),
		sceneExpand: t("sceneExpand")
	};
}
/** The Godot mark as a mask, so it takes the row's icon colour. */
const GODOT_MASK$1 = {
	maskImage: `url("${godot_logo_svg_default}")`,
	WebkitMaskImage: `url("${godot_logo_svg_default}")`
};
/**
* Keeps a broken report from taking the row with it.
*
* A throw inside the expanded content unmounts the slot's subtree, which in the
* transcript looks like "click and the row disappears" with nothing to read. The
* report is wrapped in this boundary so the row and its summary survive, and the
* failure is logged where it can be seen.
*/
var ReportGuard = class extends react.Component {
	state = {
		failed: false,
		message: ""
	};
	static getDerivedStateFromError(error) {
		return {
			failed: true,
			message: error instanceof Error ? error.message : String(error)
		};
	}
	componentDidCatch(error) {
		console.error("[godot_debug] the card report failed to render", error);
	}
	render() {
		if (!this.state.failed) return this.props.children;
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
			className: DebugCard_module_css_default.bad,
			children: ["report failed: ", this.state.message]
		}), this.props.fallback] });
	}
};
/**
* Adapt one scene-tree node of a stop to a tree row.
*
* The protocol reports a scripted node's class as the script path (`res://…`),
* so such a node draws the script glyph and shows the path as its class text.
*/
function toModel$3(node, parent = "", captured = /* @__PURE__ */ new Set()) {
	const scripted = node.className.startsWith("res://");
	const path = parent === "" ? node.name : `${parent}/${node.name}`;
	const title = [
		node.name,
		node.className,
		`id ${node.id}`,
		node.sceneFilePath
	].filter((part) => part !== "").join("\n");
	return {
		key: `${node.id}:${node.name}`,
		name: node.name,
		subtitle: node.className,
		iconClass: scripted ? "Script" : node.className,
		...scripted ? { script: node.className } : {},
		title,
		path,
		...captured.has(node.id) ? { marked: true } : {},
		children: node.children.map((child) => toModel$3(child, path, captured))
	};
}
/**
* What the card can say about one picked node.
*
* A finished run is a snapshot: the game has exited, so the card reports the
* identity the protocol sent and, when the run expanded that object, the rows it
* captured. Anything more needs a re-run with `expandNodes` or `nodePaths`.
*/
function nodeInfo(node, entries) {
	const findDeep = (list) => {
		for (const entry of list) {
			if (entry.id === node.id) return entry;
			const nested = findDeep(entryChildren(entry));
			if (nested !== void 0) return nested;
		}
	};
	return findDeep(entries);
}
/**
* The row key the card opens on: a node the run captured, else the first node.
*
* A run that expanded something did so because the reader asked about it, so that
* node is the one worth showing; without an expansion the stop's own root is the
* least surprising pick.
*/
function defaultKey(nodes, entries) {
	const captured = firstExpanded(nodes, entries);
	if (captured !== void 0) return `${captured.id}:${captured.name}`;
	const first = nodes[0];
	return first === void 0 ? void 0 : `${first.id}:${first.name}`;
}
/**
* The first node of a tree the run expanded.
*/
function firstExpanded(nodes, entries) {
	for (const node of nodes) {
		if (entries.some((entry) => entry.id === node.id)) return node;
		const inner = firstExpanded(node.children, entries);
		if (inner !== void 0) return inner;
	}
}
/**
* Find a node by the row key the tree reports (`id:name`).
*/
function findNode(nodes, key, parent = "") {
	if (key === void 0) return void 0;
	for (const node of nodes) {
		const path = parent === "" ? node.name : `${parent}/${node.name}`;
		if (`${node.id}:${node.name}` === key) return {
			node,
			path
		};
		const inner = findNode(node.children, key, path);
		if (inner !== void 0) return inner;
	}
}
/**
* The row keys above `key`, so a tree opens along the path to the picked node.
*/
function pathKeys(nodes, key) {
	const open = /* @__PURE__ */ new Set();
	const walk = (list, trail) => {
		for (const node of list) {
			const nodeKey = `${node.id}:${node.name}`;
			const next = [...trail, nodeKey];
			if (nodeKey === key) {
				for (const part of next) open.add(part);
				return true;
			}
			if (walk(node.children, next)) return true;
		}
		return false;
	};
	if (key !== void 0) walk(nodes, []);
	return open;
}
/** Every object id the sample holds, nested objects included: the rows the run has state for. */
function capturedIdSet(entries) {
	const ids = /* @__PURE__ */ new Set();
	const walk = (list) => {
		for (const entry of list) {
			ids.add(entry.id);
			walk(entryChildren(entry));
		}
	};
	walk(entries);
	return ids;
}
/** One stop: the top frame in the summary, everything else folded inside. */
function StopSection(props) {
	const { stop, entries, t, cut, sampledElsewhere } = props;
	const nodes = stop.sceneTree?.nodes ?? [];
	const hasNodes = nodes.length > 0;
	const capturedIds = capturedIdSet(entries);
	const [selected, setSelected] = (0, react.useState)(() => defaultKey(nodes, entries));
	const picked = findNode(nodes, selected);
	const info = picked === void 0 ? void 0 : nodeInfo(picked.node, entries);
	const top = stop.frames[0];
	const where = top === void 0 ? "" : `${top.func} — ${top.file}:${top.line}`;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
		className: DebugCard_module_css_default.stop,
		open: stop.index === 0,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", {
				className: DebugCard_module_css_default.stopHead,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: DebugCard_module_css_default.stopIndex,
						children: ["#", stop.index + 1]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: DebugCard_module_css_default.stopWhere,
						children: where
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: DebugCard_module_css_default.stopReason,
						children: stop.reason
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: DebugCard_module_css_default.stopThread,
						children: ["thread ", stop.threadId]
					})
				]
			}),
			stop.frames.length > 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: DebugCard_module_css_default.section,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
					className: DebugCard_module_css_default.sectionTitle,
					children: t("debugFrames")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
					className: DebugCard_module_css_default.frames,
					children: stop.frames.map((frame) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: frame.func }),
						" ",
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: DebugCard_module_css_default.dim,
							children: [
								frame.file,
								":",
								frame.line
							]
						})
					] }, `${frame.file}:${frame.line}:${frame.func}`))
				})]
			}),
			stop.varsLines !== void 0 && stop.varsLines.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: DebugCard_module_css_default.section,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
					className: DebugCard_module_css_default.sectionTitle,
					children: t("debugVars")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
					className: DebugCard_module_css_default.block,
					children: stop.varsLines.join("\n")
				})]
			}),
			hasNodes ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: DebugCard_module_css_default.section,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h4", {
						className: DebugCard_module_css_default.sectionTitle,
						children: [
							t("debugSceneTree"),
							" · ",
							nodes.length,
							" ",
							t("debugTreeNodeCount"),
							stop.sceneTree?.truncated === true ? ` · ${t("debugTreeTruncated")}` : ""
						]
					}),
					sampledElsewhere && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: DebugCard_module_css_default.dim,
						children: t("debugNoExpansionHere")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(NodeTree, {
						roots: nodes.map((root) => toModel$3(root, "", capturedIds)),
						selected,
						onSelect: (node) => {
							setSelected(node.key);
						},
						t: treeLocale$1(t),
						openKeys: pathKeys(nodes, selected)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: DebugCard_module_css_default.nodeInfo,
						children: picked === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: DebugCard_module_css_default.dim,
							children: t("debugPickNode")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: DebugCard_module_css_default.nodeHead,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: picked.path }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: DebugCard_module_css_default.dim,
										children: picked.node.className
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: DebugCard_module_css_default.dim,
										children: ["id ", picked.node.id]
									})
								]
							}),
							picked.node.sceneFilePath !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: DebugCard_module_css_default.dim,
								children: picked.node.sceneFilePath
							}),
							info === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: DebugCard_module_css_default.dim,
								children: t("debugNodeNotExpanded")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
								className: DebugCard_module_css_default.rows,
								children: [info.rows.slice(0, ROW_LIMIT).map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: DebugCard_module_css_default.rowName,
									children: row.name
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: DebugCard_module_css_default.rowValue,
									children: row.value
								})] }, row.name)), info.rows.length > ROW_LIMIT && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
									className: DebugCard_module_css_default.dim,
									children: t("debugMoreRows").replace("{n}", String(info.rows.length - ROW_LIMIT))
								})]
							})
						] })
					})
				]
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: `${DebugCard_module_css_default.note} ${DebugCard_module_css_default.dim}`,
				children: stop.frames.length === 0 ? t("debugTreeNoFrames") : cut === "sceneTree" ? t("debugTreeCut") : t("debugTreeNotCaptured")
			})
		]
	});
}
/** One expanded object and the objects nested inside it. */
function Entry(props) {
	const { entry, depth, t } = props;
	const head = entry.repr === void 0 ? `${entry.className}<${entry.id}>` : entry.repr;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
		className: DebugCard_module_css_default.entry,
		style: { marginLeft: `${depth * 16}px` },
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: DebugCard_module_css_default.entryHead,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: entry.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: DebugCard_module_css_default.dim,
					children: head
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
				className: DebugCard_module_css_default.rows,
				children: [entryRows(entry).slice(0, ROW_LIMIT).map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: DebugCard_module_css_default.rowName,
					children: row.name
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: DebugCard_module_css_default.rowValue,
					children: row.value
				})] }, row.name)), entryRows(entry).length > ROW_LIMIT && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", {
					className: DebugCard_module_css_default.dim,
					children: t("debugMoreRows").replace("{n}", String(entryRows(entry).length - ROW_LIMIT))
				})]
			}),
			entryChildren(entry).length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
				className: DebugCard_module_css_default.entries,
				children: entryChildren(entry).map((child) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Entry, {
					entry: child,
					depth: depth + 1,
					t
				}, `${child.name}:${child.id}`))
			})
		]
	});
}
/**
* Render one `godot_debug` call.
*
* A toolview entry that throws is abdicated by the slot registry for the rest
* of the session, so an unexpected wire shape must degrade to the text report
* instead of taking the card away.
*/
function DebugCard(props) {
	const disclosure = useCardFold(props.callId ?? "godot_debug");
	try {
		return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DebugCardBody, {
			...props,
			disclosure
		});
	} catch (error) {
		const fallback = callText(props.block ?? void 0);
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
			open: true,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", {
				className: DebugCard_module_css_default.head,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: props.toolName ?? "godot_debug" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: error instanceof Error ? error.message : String(error) })]
			}), fallback !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
				className: DebugCard_module_css_default.block,
				children: fallback
			})]
		});
	}
}
/** The card itself; {@link DebugCard} guards it. */
function DebugCardBody(props) {
	const { t, disclosure } = props;
	const block = props.block;
	const args = callArgs(block);
	const meta = block?.meta;
	const view = asDebugView(meta?.view);
	const attach = args.mode === "attach";
	const target = attach ? typeof args.port === "number" ? `:${args.port}` : t("debugAttachTarget") : typeof args.scene === "string" && args.scene !== "" ? args.scene : t("debugMainScene");
	const breakpoints = Array.isArray(args.breakpoints) ? args.breakpoints.length : 0;
	const chips = [];
	if (view !== void 0) {
		chips.push(`${view.stopCount} ${t("debugStops")}`);
		if (view.detached) chips.push(t("debugDetached"));
		if (view.sceneTreeCount > 0) chips.push(`${view.sceneTreeCount} ${t("debugSceneTrees")}`);
		if (view.editsApplied > 0) chips.push(`${view.editsApplied} ${t("debugEdits")}`);
		if (view.expandedObjects > 0) chips.push(`${view.expandedObjects} ${t("debugExpanded")}`);
		if (view.viewTruncated === true || view.expansionTruncated || view.editsTruncated || view.sceneTreeTruncated || view.outputTruncated || view.varsTruncated) chips.push(t("debugTruncated"));
	}
	const failed = block?.isError === true;
	const fallbackText = failed || view === void 0 ? callText(block) : "";
	const hasBody = view !== void 0 || fallbackText !== "";
	const reportText = callText(block);
	const facts = [
		`${attach ? t("debugAttach") : t("debugLaunch")} · ${target}`,
		breakpoints > 0 ? `${breakpoints} ${t("debugBreakpoints")}` : "",
		...chips,
		hasBody ? "" : t("debugRunning")
	].filter((part) => part !== "").join(" · ");
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
		icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			className: DebugCard_module_css_default.icon,
			style: GODOT_MASK$1,
			"aria-hidden": "true"
		}),
		title: props.toolName ?? "godot_debug",
		titleClassName: failed ? DebugCard_module_css_default.failed : void 0,
		open: disclosure.expanded,
		expandable: true,
		onToggle: disclosure.toggle,
		expandOnRowClick: true,
		previewChevron: true,
		running: !hasBody,
		keepContentWhenOpen: true,
		collapsedContent: hasBody ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(__deepseek_ai_dsh_client_ui_primitives.TextShimmer, {
			className: DebugCard_module_css_default.facts,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: DebugCard_module_css_default.sep,
				"aria-hidden": "true"
			}), facts]
		}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
			className: DebugCard_module_css_default.facts,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: DebugCard_module_css_default.sep,
				"aria-hidden": "true"
			}), facts]
		}),
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReportGuard, {
			fallback: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
				className: DebugCard_module_css_default.block,
				children: reportText
			}),
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: DebugCard_module_css_default.bodyWrap,
				children: [view === void 0 ? fallbackText === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
					className: DebugCard_module_css_default.block,
					children: fallbackText
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: DebugCard_module_css_default.stops,
						children: view.stops.map((stop) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StopSection, {
							stop,
							entries: view.expansion?.stopIndex === stop.index ? view.expansion.entries : [],
							cut: view.viewCut,
							sampledElsewhere: view.expansion !== void 0 && view.expansion.stopIndex !== stop.index,
							t
						}, stop.index))
					}),
					view.expansion !== void 0 && view.expansion.entries.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						className: DebugCard_module_css_default.stop,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", {
							className: DebugCard_module_css_default.stopHead,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: DebugCard_module_css_default.stopWhere,
								children: t("debugExpansion")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: DebugCard_module_css_default.stopReason,
								children: view.expansion.expandedObjects
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: DebugCard_module_css_default.entries,
							children: view.expansion.entries.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Entry, {
								entry,
								depth: 0,
								t
							}, `${entry.name}:${entry.id}`))
						})]
					}),
					view.edits !== void 0 && view.edits.results.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						className: DebugCard_module_css_default.stop,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", {
							className: DebugCard_module_css_default.stopHead,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: DebugCard_module_css_default.stopWhere,
								children: t("debugEdits")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: DebugCard_module_css_default.stopReason,
								children: view.editsApplied
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
							className: DebugCard_module_css_default.rows,
							children: view.edits.results.map((result) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("code", { children: [
									result.target,
									".",
									result.property
								] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: result.ok ? DebugCard_module_css_default.ok : DebugCard_module_css_default.bad,
									children: String(result.requested)
								}),
								result.detail !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: DebugCard_module_css_default.dim,
									children: result.detail
								})
							] }, `${result.target}:${result.property}`))
						})]
					}),
					(view.outputTail.length > 0 || view.errors.length > 0) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
						className: DebugCard_module_css_default.stop,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", {
								className: DebugCard_module_css_default.stopHead,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: DebugCard_module_css_default.stopWhere,
									children: t("debugOutput")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: DebugCard_module_css_default.stopReason,
									children: [view.outputTail.length + view.errors.length, view.outputTruncated ? ` · ${t("debugTruncated")}` : ""]
								})]
							}),
							view.errors.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
								className: `${DebugCard_module_css_default.block} ${DebugCard_module_css_default.bad}`,
								children: view.errors.join("\n")
							}),
							view.outputTail.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
								className: DebugCard_module_css_default.block,
								children: view.outputTail.join("\n")
							})
						]
					}),
					view.exit !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: DebugCard_module_css_default.exit,
						children: view.exit.exitCode !== void 0 ? `exit ${view.exit.exitCode}` : `signal ${view.exit.signal ?? ""}`
					})
				] }), props.inspect === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: DebugCard_module_css_default.inspect,
					onClick: () => {
						props.inspect?.();
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
						width: "12",
						height: "12",
						"aria-hidden": "true",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("use", { href: "#dsw-icon-inspect-outline-regular" })
					}), t("debugInspect")]
				})]
			})
		})
	});
}

//#endregion
//#region \0godot-css:D:/projects/dsh-godot/ui-godot/src/client/scene/SceneBody.module.css.mjs
const css$3 = "/* The .godot_SceneBody_module_css_tscn body: a node tree on the left, the selected node's source on the right. */\r\n\r\n.godot_SceneBody_module_css_body {\r\n  display: flex;\r\n  flex-direction: column;\r\n  height: 100%;\r\n  min-height: 0;\r\n  font: var(--dsw-font-xs-13);\r\n  color: var(--dsw-alias-label-secondary);\r\n}\r\n\r\n.godot_SceneBody_module_css_header {\r\n  display: flex;\r\n  align-items: baseline;\r\n  gap: 10px;\r\n  padding: 8px 12px;\r\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\r\n  flex: none;\r\n}\r\n\r\n.godot_SceneBody_module_css_root {\r\n  font: var(--dsw-font-xs-13-strong);\r\n  color: var(--dsw-alias-label-primary);\r\n}\r\n\r\n.godot_SceneBody_module_css_meta {\r\n  color: var(--dsw-alias-label-tertiary);\r\n}\r\n\r\n.godot_SceneBody_module_css_panes {\r\n  display: grid;\r\n  grid-template-columns: minmax(220px, 1fr) minmax(240px, 1fr);\r\n  min-height: 0;\r\n  flex: 1;\r\n}\r\n\r\n.godot_SceneBody_module_css_detail {\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 6px;\r\n  min-height: 0;\r\n  padding: 8px 12px;\r\n  overflow: auto;\r\n}\r\n\r\n.godot_SceneBody_module_css_detailHead {\r\n  display: flex;\r\n  gap: 10px;\r\n  align-items: baseline;\r\n  color: var(--dsw-alias-label-primary);\r\n}\r\n\r\n.godot_SceneBody_module_css_detailMeta {\r\n  color: var(--dsw-alias-label-tertiary);\r\n}\r\n\r\n.godot_SceneBody_module_css_source {\r\n  margin: 0;\r\n  padding: 8px;\r\n  border-radius: 4px;\r\n  background: var(--dsw-alias-bg-layer-2);\r\n  font-family: var(--dsw-font-family-mono);\r\n  white-space: pre-wrap;\r\n  overflow-x: auto;\r\n}\r\n\r\n.godot_SceneBody_module_css_note {\r\n  padding: 12px;\r\n  color: var(--dsw-alias-label-tertiary);\r\n}\r\n";
const tag$3 = "ui-godot:SceneBody.module.css";
if (typeof document !== "undefined" && document.getElementById(tag$3) === null) {
	const style = document.createElement("style");
	style.id = tag$3;
	style.dataset.plugin = "ui-godot";
	style.textContent = css$3;
	document.head.appendChild(style);
}
var SceneBody_module_css_default = {
	"tscn": "godot_SceneBody_module_css_tscn",
	"body": "godot_SceneBody_module_css_body",
	"header": "godot_SceneBody_module_css_header",
	"root": "godot_SceneBody_module_css_root",
	"meta": "godot_SceneBody_module_css_meta",
	"panes": "godot_SceneBody_module_css_panes",
	"detail": "godot_SceneBody_module_css_detail",
	"detailHead": "godot_SceneBody_module_css_detailHead",
	"detailMeta": "godot_SceneBody_module_css_detailMeta",
	"source": "godot_SceneBody_module_css_source",
	"note": "godot_SceneBody_module_css_note"
};

//#endregion
//#region src/client/scene/tscn.ts
const HEADER = /^\[(\w+)([^\]]*)\]/;
/** `key="value"` / `key=123` / `key=ExtResource("x")` attributes of a header. */
function headerAttrs(rest) {
	const attrs = /* @__PURE__ */ new Map();
	for (const match of rest.matchAll(/(\w+)=(?:"([^"]*)"|(\S+))/g)) {
		const value = (match[2] ?? match[3] ?? "").trim();
		attrs.set(match[1], value);
	}
	return attrs;
}
/** `ExtResource("script_1")` → `script_1`. */
function extResourceId(value) {
	if (value === void 0) return void 0;
	return /ExtResource\(\s*"([^"]+)"\s*\)/.exec(value)?.[1];
}
/** The node path a header's `parent=` names, given the root name. */
function parentPathOf(parent, root) {
	if (parent === void 0 || parent === "") return null;
	if (parent === ".") return root;
	return `${root}/${parent}`;
}
/**
* Parse one `.tscn` file.
*/
function parseTscn(text) {
	const lines = text.split(/\r?\n/);
	const resources = [];
	const byId = /* @__PURE__ */ new Map();
	for (const line of lines) {
		const header = HEADER.exec(line);
		if (header?.[1] !== "ext_resource") continue;
		const attrs = headerAttrs(header[2] ?? "");
		const resource = {
			id: attrs.get("id") ?? "",
			type: attrs.get("type") ?? "",
			path: attrs.get("path") ?? ""
		};
		resources.push(resource);
		byId.set(resource.id, resource);
	}
	const drafts = [];
	let current;
	let rootName;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const header = HEADER.exec(line);
		if (header !== null) {
			if (current !== void 0) drafts.push(current);
			current = void 0;
			if (header[1] === "node") {
				const attrs = headerAttrs(header[2] ?? "");
				const name = attrs.get("name") ?? "";
				const parent = attrs.get("parent");
				if (parent === void 0 && rootName === void 0) rootName = name;
				const instanceId = extResourceId(attrs.get("instance"));
				const scriptId = extResourceId(attrs.get("script"));
				current = {
					name,
					type: attrs.get("type") ?? "",
					parentPath: parentPathOf(parent, rootName ?? name),
					line: index + 1,
					body: [line],
					unique: false,
					...instanceId !== void 0 && byId.get(instanceId) !== void 0 ? { instance: byId.get(instanceId).path } : {},
					...scriptId !== void 0 && byId.get(scriptId) !== void 0 ? { script: byId.get(scriptId).path } : {}
				};
			}
			continue;
		}
		if (current !== void 0) {
			current.body.push(line);
			if (/^\s*unique_name_in_owner\s*=\s*true/.test(line)) current.unique = true;
			const scriptLine = /^\s*script\s*=\s*ExtResource\(\s*"([^"]+)"\s*\)/.exec(line);
			if (scriptLine !== null) {
				const resource = byId.get(scriptLine[1]);
				if (resource !== void 0) current.script = resource.path;
			}
		}
	}
	if (current !== void 0) drafts.push(current);
	const root = rootName === void 0 ? "" : rootName;
	if (root === "" && drafts.length === 0) return {
		rootName: "",
		root: void 0,
		nodes: [],
		resources
	};
	const nodes = /* @__PURE__ */ new Map();
	for (const draft of drafts) {
		const path = draft.parentPath === null ? draft.name : `${draft.parentPath}/${draft.name}`;
		const children = [];
		const node = {
			name: draft.name,
			type: draft.type,
			path,
			parent: draft.parentPath,
			line: draft.line,
			body: draft.body.join("\n").replace(/\n+$/, ""),
			unique: draft.unique,
			children,
			...draft.script !== void 0 ? { script: draft.script } : {},
			...draft.instance !== void 0 ? { instance: draft.instance } : {}
		};
		nodes.set(path, {
			node,
			children
		});
	}
	const rootEntry = nodes.get(root);
	const orphans = [];
	for (const entry of nodes.values()) {
		if (entry === rootEntry) continue;
		const parentEntry = entry.node.parent === null ? void 0 : nodes.get(entry.node.parent);
		if (parentEntry !== void 0 && parentEntry !== entry) parentEntry.children.push(entry.node);
		else if (rootEntry !== void 0) rootEntry.children.push(entry.node);
		else orphans.push(entry.node);
	}
	const ordered = [];
	const visit = (node) => {
		ordered.push(node);
		for (const child of node.children) visit(child);
	};
	if (rootEntry !== void 0) visit(rootEntry.node);
	for (const orphan of orphans) visit(orphan);
	return {
		rootName: root,
		root: rootEntry?.node,
		nodes: ordered,
		resources
	};
}

//#endregion
//#region src/client/scene/SceneBody.tsx
/**
* Adapt one parsed scene node to a tree row.
*/
function toModel$2(node) {
	const iconClass = node.type !== "" ? node.type : "Script";
	return {
		key: node.path,
		name: node.name,
		...node.type !== "" ? { subtitle: node.type } : {},
		iconClass,
		...node.script !== void 0 ? { script: node.script } : {},
		...node.instance !== void 0 ? { instance: node.instance } : {},
		unique: node.unique,
		line: node.line,
		children: node.children.map(toModel$2)
	};
}
/**
* Render one `.tscn` file as a node tree.
*/
function SceneBody(props) {
	const { t } = props;
	const text = props.content.kind === "text" ? props.content.text : "";
	const scene = (0, react.useMemo)(() => parseTscn(text), [text]);
	const [selected, setSelected] = (0, react.useState)();
	const selectedNode = scene.nodes.find((node) => node.path === selected);
	if (props.content.kind !== "text") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: SceneBody_module_css_default.note,
		children: t("sceneLoading")
	});
	if (scene.root === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: SceneBody_module_css_default.note,
		children: t("sceneEmpty")
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: SceneBody_module_css_default.body,
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: SceneBody_module_css_default.header,
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: SceneBody_module_css_default.root,
					children: scene.rootName
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: SceneBody_module_css_default.meta,
					children: [
						scene.nodes.length,
						" ",
						t("sceneNodes")
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: SceneBody_module_css_default.meta,
					children: [
						scene.resources.length,
						" ",
						t("sceneResources")
					]
				})
			]
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: SceneBody_module_css_default.panes,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: SceneBody_module_css_default.treePane,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NodeTree, {
					roots: [toModel$2(scene.root)],
					selected,
					onSelect: (node) => {
						setSelected(node.key);
					},
					t
				})
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: SceneBody_module_css_default.detail,
				children: selectedNode === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: SceneBody_module_css_default.note,
					children: t("scenePickNode")
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SceneBody_module_css_default.detailHead,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: selectedNode.path }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: SceneBody_module_css_default.meta,
							children: [
								t("sceneLine"),
								" ",
								selectedNode.line
							]
						})]
					}),
					selectedNode.script !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SceneBody_module_css_default.detailMeta,
						children: [
							t("sceneScript"),
							": ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: selectedNode.script })
						]
					}),
					selectedNode.instance !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: SceneBody_module_css_default.detailMeta,
						children: [
							t("sceneInstance"),
							": ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: selectedNode.instance })
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
						className: SceneBody_module_css_default.source,
						children: selectedNode.body
					})
				] })
			})]
		})]
	});
}

//#endregion
//#region \0godot-css:D:/projects/dsh-godot/ui-godot/src/client/state/StateCard.module.css.mjs
const css$2 = "/* The state card's body: the shell row and the tree draw themselves. */\n\n/* The separator the shell rows draw between a title and its summary: a 2 px dot.\n   `collapsedContent` renders inside a text span, so the dot is inline-block. */\n.godot_StateCard_module_css_sep {\n  display: inline-block;\n  width: 2px;\n  height: 2px;\n  border-radius: 1px;\n  margin: 0 8px;\n  vertical-align: middle;\n  background: var(--dsw-alias-label-caption);\n}\n\n/* A failed read reads as a failure in the row's own title. */\n.godot_StateCard_module_css_failed {\n  color: var(--dsw-alias-label-danger);\n}\n\n/* The read's facts sit at the row's secondary tier, the same one the row title\n   uses: the content variable, not a fixed token, so a reader's font scale still\n   applies. */\n.godot_StateCard_module_css_facts {\n  font-size: var(--dsh-content-font-size-secondary, 13px);\n  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));\n  color: var(--dsw-alias-label-tertiary);\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n/* The mark is masked, so it takes the row's icon colour: 14 px, currentColor,\n   replaced by the chevron on hover. */\n.godot_StateCard_module_css_icon {\n  display: block;\n  width: 14px;\n  height: 14px;\n  flex: none;\n  background-color: currentColor;\n  mask-repeat: no-repeat;\n  mask-position: center;\n  mask-size: contain;\n}\n\n/* The card sits on the row's own indent; the sections inside it need none. The\n   body rides the secondary tier because the tree beside it does. */\n.godot_StateCard_module_css_bodyWrap {\n  font-size: var(--dsh-content-font-size-secondary, 13px);\n  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));\n  margin: 8px 0 0 20px;\n  padding: 10px 14px;\n  border-radius: var(--dsw-radius-lg);\n  background: var(--dsw-alias-markdown-code-block);\n}\n\n.godot_StateCard_module_css_head {\n  margin: 0 0 4px;\n  font: var(--dsw-font-xs-13-strong);\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* Text sits on the card's own surface: the shell's code blocks draw no inner box. */\n.godot_StateCard_module_css_block {\n  margin: 4px 0 0;\n  font-family: var(--dsw-font-family-mono);\n  white-space: pre-wrap;\n  overflow-x: auto;\n  max-height: 320px;\n}\n\n.godot_StateCard_module_css_dim {\n  color: var(--dsw-alias-label-tertiary);\n}\n";
const tag$2 = "ui-godot:StateCard.module.css";
if (typeof document !== "undefined" && document.getElementById(tag$2) === null) {
	const style = document.createElement("style");
	style.id = tag$2;
	style.dataset.plugin = "ui-godot";
	style.textContent = css$2;
	document.head.appendChild(style);
}
var StateCard_module_css_default = {
	"sep": "godot_StateCard_module_css_sep",
	"failed": "godot_StateCard_module_css_failed",
	"facts": "godot_StateCard_module_css_facts",
	"icon": "godot_StateCard_module_css_icon",
	"bodyWrap": "godot_StateCard_module_css_bodyWrap",
	"head": "godot_StateCard_module_css_head",
	"block": "godot_StateCard_module_css_block",
	"dim": "godot_StateCard_module_css_dim"
};

//#endregion
//#region src/client/state/state-view.ts
/** One diff list as paths (malformed entries dropped). */
function asPaths(value) {
	if (!Array.isArray(value)) return [];
	return value.filter((path) => typeof path === "string");
}
/** One node, or undefined when the wire shape is not a node. */
function asNode(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const node = value;
	if (typeof node.name !== "string") return void 0;
	return {
		name: node.name,
		className: typeof node.className === "string" ? node.className : "",
		id: typeof node.id === "string" ? node.id : "",
		scene: typeof node.scene === "string" ? node.scene : "",
		unique: node.unique === true,
		script: typeof node.script === "string" ? node.script : "",
		children: (Array.isArray(node.children) ? node.children : []).flatMap((child) => asNode(child) ?? [])
	};
}
/**
* Whether a value can be treated as a state view.
*
* The view crosses the tool-result boundary as plain JSON, so the node list is
* checked once here: a malformed node is dropped rather than thrown at render.
* @param value - the persisted meta view.
* @returns the view, or undefined when it is not one.
*/
function asStateView(value) {
	if (typeof value !== "object" || value === null) return void 0;
	const view = value;
	const nodes = Array.isArray(view.nodes) ? view.nodes.flatMap((node) => asNode(node) ?? []) : void 0;
	return {
		version: typeof view.version === "number" ? view.version : 0,
		scene: typeof view.scene === "string" ? view.scene : "",
		fps: typeof view.fps === "number" ? view.fps : 0,
		frame: typeof view.frame === "number" ? view.frame : 0,
		nodeCount: typeof view.nodeCount === "number" ? view.nodeCount : 0,
		paused: view.paused === true,
		...nodes === void 0 ? {} : { nodes },
		...view.treeTruncated === true ? { treeTruncated: true } : {},
		...view.viewTruncated === true ? { viewTruncated: true } : {},
		...typeof view.changed === "object" && view.changed !== null ? { changed: {
			appeared: asPaths(view.changed.appeared),
			changed: asPaths(view.changed.changed),
			disappeared: asPaths(view.changed.disappeared)
		} } : {},
		...view.viewCut === "nodes" || view.viewCut === "changed" ? { viewCut: view.viewCut } : {}
	};
}

//#endregion
//#region src/client/state/StateCard.tsx
/** The Godot mark as a mask, so it takes the row's icon colour. */
const GODOT_MASK = {
	maskImage: `url("${godot_logo_svg_default}")`,
	WebkitMaskImage: `url("${godot_logo_svg_default}")`
};
/** The tree's labels, from the card's own namespace. */
function treeLocale(t) {
	return {
		sceneScript: t("sceneScript"),
		sceneInstance: t("sceneInstance"),
		sceneUnique: t("sceneUnique"),
		sceneCollapse: t("sceneCollapse"),
		sceneExpand: t("sceneExpand")
	};
}
/** Count one view subtree (the rows the card holds). */
function countNodes(nodes) {
	return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0);
}
/** Adapt one live node to a tree row: the class text, the script glyph, the `%`, the mark. */
/** Adapt one live node to a tree row: the class text, the script glyph, the `%`. */
function toModel$1(node, parent, changed) {
	const path = parent === "" ? node.name : `${parent}/${node.name}`;
	const scripted = node.className.startsWith("res://");
	return {
		key: path,
		name: node.name,
		...node.className === "" ? {} : { subtitle: node.className },
		iconClass: scripted ? "Script" : node.className,
		...node.script === "" ? {} : { script: node.script },
		...node.scene === "" ? {} : { instance: node.scene },
		unique: node.unique,
		path,
		...node.id === "" ? {} : { title: `${path} (${node.id})` },
		...changed.has(path) ? { marked: true } : {},
		children: node.children.map((child) => toModel$1(child, path, changed))
	};
}
/** Render one `godot_state` call. */
function StateCard(props) {
	const { t } = props;
	const disclosure = useCardFold(props.callId ?? "godot_state");
	const block = props.block;
	const view = asStateView((block?.meta)?.view);
	const fallbackText = callText(block);
	const facts = view === void 0 ? "" : [
		view.scene === "" ? t("debugMainScene") : view.scene,
		`${view.fps} fps`,
		`${t("stateFrame")} ${view.frame}`,
		`${view.nodeCount} ${t("sceneNodes")}`,
		...view.paused ? [t("statePaused")] : []
	].join(" · ");
	const hasBody = view !== void 0 || fallbackText !== "";
	const nodes = view?.nodes ?? [];
	const changed = new Set([...view?.changed?.appeared ?? [], ...view?.changed?.changed ?? []]);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
		icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
			className: StateCard_module_css_default.icon,
			style: GODOT_MASK,
			"aria-hidden": "true"
		}),
		title: props.toolName ?? "godot_state",
		titleClassName: block?.isError === true ? StateCard_module_css_default.failed : void 0,
		open: disclosure.expanded,
		expandable: true,
		onToggle: disclosure.toggle,
		expandOnRowClick: true,
		previewChevron: true,
		running: !hasBody,
		keepContentWhenOpen: true,
		collapsedContent: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
			className: StateCard_module_css_default.facts,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: StateCard_module_css_default.sep,
				"aria-hidden": "true"
			}), facts]
		}),
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: StateCard_module_css_default.bodyWrap,
			children: view === void 0 ? fallbackText === "" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
				className: StateCard_module_css_default.block,
				children: fallbackText
			}) : nodes.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: StateCard_module_css_default.dim,
				children: t("stateNoTree")
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("h4", {
				className: StateCard_module_css_default.head,
				children: [
					`${t("debugSceneTree")} · ${view.treeTruncated === true ? `${String(countNodes(nodes))} / ${String(view.nodeCount)}` : String(view.nodeCount)} ${t("sceneNodes")}`,
					view.treeTruncated === true ? ` · ${t("debugTreeTruncated")}` : "",
					changed.size === 0 ? "" : ` · ${t("stateChanged")} ${String(changed.size)}`
				]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NodeTree, {
				roots: nodes.map((root) => toModel$1(root, "", changed)),
				selected: void 0,
				t: treeLocale(t)
			})] })
		})
	});
}

//#endregion
//#region \0godot-css:D:/projects/dsh-godot/ui-godot/src/client/GodotCard.module.css.mjs
const css$1 = ".godot_GodotCard_module_css_card {\n  list-style: none;\n  border: 1px solid var(--dsw-alias-border-l2);\n  border-radius: 8px;\n  background: var(--dsw-alias-bg-layer-3);\n  padding: 12px 16px;\n}\n\n.godot_GodotCard_module_css_head {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  flex-wrap: wrap;\n}\n\n.godot_GodotCard_module_css_logo {\n  width: 22px;\n  height: 22px;\n  object-fit: contain;\n  flex: none;\n}\n\n.godot_GodotCard_module_css_name {\n  font: var(--dsw-font-s-strong-14);\n  color: var(--dsw-alias-label-primary);\n}\n\n.godot_GodotCard_module_css_note {\n  font: var(--dsw-font-xs-13);\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.godot_GodotCard_module_css_desc {\n  font: var(--dsw-font-xs-13);\n  color: var(--dsw-alias-label-secondary);\n  margin-top: 2px;\n}\n\n.godot_GodotCard_module_css_field {\n  display: grid;\n  grid-template-columns: 170px minmax(0, 1fr) auto;\n  gap: 8px;\n  align-items: center;\n  margin-top: 10px;\n}\n\n.godot_GodotCard_module_css_label {\n  font: var(--dsw-font-xs-13);\n  color: var(--dsw-alias-label-secondary);\n}\n\n.godot_GodotCard_module_css_control {\n  border: 1px solid var(--dsw-alias-border-l2);\n  background: var(--dsw-alias-bg-layer-2);\n  color: var(--dsw-alias-label-primary);\n  border-radius: 6px;\n  padding: 4px 8px;\n  font: var(--dsw-font-xs-13);\n  width: 100%;\n  box-sizing: border-box;\n  outline: none;\n}\n\n.godot_GodotCard_module_css_control:focus {\n  border-color: var(--dsw-alias-brand-primary);\n}\n\n.godot_GodotCard_module_css_control:disabled {\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.godot_GodotCard_module_css_control[data-invalid='true'] {\n  border-color: var(--dsw-alias-label-error);\n}\n\n.godot_GodotCard_module_css_hint {\n  font: var(--dsw-font-xxxs-11);\n  color: var(--dsw-alias-label-tertiary);\n  margin-top: 2px;\n  line-height: 1.5;\n}\n\n.godot_GodotCard_module_css_chip {\n  font: var(--dsw-font-xxxs-11);\n  color: var(--dsw-alias-label-secondary);\n  background: var(--dsw-alias-bg-module-platform);\n  border-radius: 4px;\n  padding: 1px 6px;\n  white-space: nowrap;\n}\n\n.godot_GodotCard_module_css_reset {\n  border: none;\n  background: none;\n  color: var(--dsw-alias-label-tertiary);\n  font: var(--dsw-font-xxxs-11);\n  cursor: pointer;\n  padding: 0;\n  text-decoration: underline;\n}\n\n.godot_GodotCard_module_css_reset:hover:not(:disabled) {\n  color: var(--dsw-alias-label-secondary);\n}\n\n.godot_GodotCard_module_css_actions {\n  display: flex;\n  gap: 8px;\n  margin-top: 12px;\n}\n\n.godot_GodotCard_module_css_btn {\n  border: 1px solid var(--dsw-alias-label-dimmed);\n  background: transparent;\n  color: var(--dsw-alias-label-primary);\n  border-radius: 6px;\n  padding: 4px 12px;\n  font: var(--dsw-font-xs-13);\n  cursor: pointer;\n}\n\n.godot_GodotCard_module_css_btn:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover-solid);\n}\n\n.godot_GodotCard_module_css_btn:disabled {\n  cursor: default;\n  opacity: 0.5;\n}\n\n.godot_GodotCard_module_css_btnPrimary {\n  border-color: transparent;\n  background: var(--dsw-alias-label-primary);\n  color: var(--dsw-alias-bg-layer-3);\n}\n";
const tag$1 = "ui-godot:GodotCard.module.css";
if (typeof document !== "undefined" && document.getElementById(tag$1) === null) {
	const style = document.createElement("style");
	style.id = tag$1;
	style.dataset.plugin = "ui-godot";
	style.textContent = css$1;
	document.head.appendChild(style);
}
var GodotCard_module_css_default = {
	"card": "godot_GodotCard_module_css_card",
	"head": "godot_GodotCard_module_css_head",
	"logo": "godot_GodotCard_module_css_logo",
	"name": "godot_GodotCard_module_css_name",
	"note": "godot_GodotCard_module_css_note",
	"desc": "godot_GodotCard_module_css_desc",
	"field": "godot_GodotCard_module_css_field",
	"label": "godot_GodotCard_module_css_label",
	"control": "godot_GodotCard_module_css_control",
	"hint": "godot_GodotCard_module_css_hint",
	"chip": "godot_GodotCard_module_css_chip",
	"reset": "godot_GodotCard_module_css_reset",
	"actions": "godot_GodotCard_module_css_actions",
	"btn": "godot_GodotCard_module_css_btn",
	"btnPrimary": "godot_GodotCard_module_css_btnPrimary"
};

//#endregion
//#region src/client/GodotCard.tsx
/** Render one labeled field. */
function Field(props) {
	/* v8 ignore next -- every godot field passes a hint (defensive arm) */
	const hint = props.hint === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: GodotCard_module_css_default.hint,
		children: props.hint
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: GodotCard_module_css_default.field,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
				className: GodotCard_module_css_default.label,
				htmlFor: props.id,
				children: props.label
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [props.control, hint] }),
			props.chips
		]
	});
}
/**
* Render the Godot card.
* @param props - the view the Plugins page asks for, locale copy, the card snapshot, and its form actions.
* @returns the one-liner in `summary` view, the form in `page` view, or nothing when the namespace is unavailable.
*/
function GodotCard(props) {
	const { t } = props;
	const state = props.useGodotCard((snapshot) => snapshot);
	if (!state.available) return null;
	if (props.view === "summary") return t("description");
	const disabled = !state.writable;
	const chipFor = (field) => state[field].overridden ? [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		className: GodotCard_module_css_default.chip,
		children: t("overridden")
	}, "chip"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
		type: "button",
		className: GodotCard_module_css_default.reset,
		disabled,
		onClick: () => {
			props.resetField(field);
		},
		children: t("reset")
	}, "reset")] : [];
	const timeoutInvalid = state.timeoutMs.invalid;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
		className: GodotCard_module_css_default.card,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: GodotCard_module_css_default.head,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
						className: GodotCard_module_css_default.logo,
						src: godot_logo_svg_default,
						alt: "",
						draggable: false
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: GodotCard_module_css_default.name,
						children: t("name")
					}),
					!state.writable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: GodotCard_module_css_default.note,
						children: t("readOnly")
					}) : null
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: GodotCard_module_css_default.desc,
				children: t("description")
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
				id: "plugin-config-godot-executable",
				label: t("executable"),
				chips: chipFor("executable"),
				hint: t("executableHint"),
				control: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					id: "plugin-config-godot-executable",
					className: GodotCard_module_css_default.control,
					value: state.executable.text,
					placeholder: t("executablePlaceholder"),
					disabled,
					onChange: (event) => {
						props.edit("executable", event.target.value);
					}
				})
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
				id: "plugin-config-godot-gdformat",
				label: t("gdformatExecutable"),
				chips: chipFor("gdformatExecutable"),
				hint: t("gdformatExecutableHint"),
				control: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					id: "plugin-config-godot-gdformat",
					className: GodotCard_module_css_default.control,
					value: state.gdformatExecutable.text,
					placeholder: t("gdformatExecutablePlaceholder"),
					disabled,
					onChange: (event) => {
						props.edit("gdformatExecutable", event.target.value);
					}
				})
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
				id: "plugin-config-godot-backend",
				label: t("formatBackend"),
				chips: chipFor("formatBackend"),
				hint: t("formatBackendHint"),
				control: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
					id: "plugin-config-godot-backend",
					className: GodotCard_module_css_default.control,
					value: state.formatBackend.text,
					disabled,
					onChange: (event) => {
						props.edit("formatBackend", event.target.value);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
						value: "gdformat",
						children: t("formatBackendGdformat")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
						value: "builtin",
						children: t("formatBackendBuiltin")
					})]
				})
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
				id: "plugin-config-godot-timeout",
				label: t("timeoutMs"),
				chips: chipFor("timeoutMs"),
				hint: t("timeoutMsHint"),
				control: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					id: "plugin-config-godot-timeout",
					className: GodotCard_module_css_default.control,
					value: state.timeoutMs.text,
					placeholder: t("timeoutMsPlaceholder"),
					inputMode: "numeric",
					"data-invalid": timeoutInvalid || void 0,
					disabled,
					onChange: (event) => {
						props.edit("timeoutMs", event.target.value);
					}
				})
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: GodotCard_module_css_default.actions,
				children: [
					state.failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: GodotCard_module_css_default.note,
						children: t("saveFailed")
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: `${GodotCard_module_css_default.btn} ${GodotCard_module_css_default.btnPrimary}`,
						disabled: disabled || !state.dirty || state.invalid || state.saving,
						onClick: props.save,
						children: t("save")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: GodotCard_module_css_default.btn,
						disabled: !state.dirty || state.saving,
						onClick: props.discard,
						children: t("discard")
					})
				]
			})
		]
	});
}

//#endregion
//#region src/client/godot-watch-controller.ts
/** Locale namespace owned by the watch panel. */
const WATCH_NS = "godot.watch";
/** Host endpoints served by `tool-godot-ego` when the plugin is mounted. */
const SESSIONS_PATH = "/api/godot/sessions";
const VIEW_PATH = "/api/godot/view";
const INPUT_PATH = "/api/godot/input";
const TREE_PATH = "/api/godot/tree";
const NODE_PATH = "/api/godot/node";
/** Parse one node of the host's tree projection; a malformed node is dropped. */
function parseTreeNode(raw) {
	if (typeof raw !== "object" || raw === null) return void 0;
	const record = raw;
	if (typeof record.name !== "string") return void 0;
	return {
		unique: record.unique === true,
		script: typeof record.script === "string" ? record.script : "",
		name: record.name,
		className: typeof record.className === "string" ? record.className : "",
		id: typeof record.id === "string" ? record.id : "",
		scene: typeof record.scene === "string" ? record.scene : "",
		children: (Array.isArray(record.children) ? record.children : []).flatMap((child) => {
			const parsed = parseTreeNode(child);
			return parsed === void 0 ? [] : [parsed];
		})
	};
}
/** Read one session entry, or undefined when the projection is malformed. */
function parseSession(raw) {
	if (typeof raw !== "object" || raw === null) return void 0;
	const record = raw;
	if (typeof record.sessionId !== "string") return void 0;
	const window$1 = Array.isArray(record.window) && record.window.length === 2 && typeof record.window[0] === "number" && typeof record.window[1] === "number" ? [record.window[0], record.window[1]] : null;
	return {
		sessionId: record.sessionId,
		state: typeof record.state === "string" ? record.state : "unknown",
		pid: typeof record.pid === "number" ? record.pid : null,
		window: window$1,
		lostReason: typeof record.lostReason === "string" ? record.lostReason : null
	};
}
/**
* The MJPEG preview URL for one session.
*/
function watchStreamUrl(sessionId) {
	return `${VIEW_PATH}?session=${encodeURIComponent(sessionId)}`;
}
/** Polls the session list and forwards panel clicks to the game. */
var GodotWatchController = class {
	store;
	fetchImpl;
	pollMs;
	setIntervalImpl;
	clearIntervalImpl;
	timer;
	refreshing = false;
	/**
	* @param options - fetch and timer seams (production uses the browser's).
	*/
	constructor(options = {}) {
		this.store = (0, __deepseek_ai_dsh_client_store.createSnapshotStore)({
			sessions: [],
			selected: void 0,
			open: false,
			error: false,
			tree: null,
			treeError: null,
			selectedNode: void 0,
			nodeDetail: null
		});
		this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
		this.pollMs = options.pollMs ?? 1500;
		this.setIntervalImpl = options.setInterval ?? ((handler, timeout) => globalThis.setInterval(handler, timeout));
		this.clearIntervalImpl = options.clearInterval ?? ((timer) => {
			globalThis.clearInterval(timer);
		});
	}
	/**
	* Start polling; calling it twice keeps one timer.
	*/
	start() {
		if (this.timer !== void 0) return;
		this.refresh();
		this.timer = this.setIntervalImpl(() => {
			this.refresh();
		}, this.pollMs);
	}
	/** Stop polling and release the timer. */
	dispose() {
		if (this.timer === void 0) return;
		this.clearIntervalImpl(this.timer);
		this.timer = void 0;
	}
	/**
	* Read the session list and update the panel.
	* @returns nothing; failures set the panel's error flag.
	*/
	async refresh() {
		if (this.refreshing) return;
		this.refreshing = true;
		try {
			const response = await this.fetchImpl(SESSIONS_PATH, { headers: { accept: "application/json" } });
			if (response.status === 404) {
				this.applySessions([]);
				return;
			}
			if (!response.ok) throw new Error(`sessions ${response.status}`);
			const body = await response.json();
			const sessions = (Array.isArray(body.sessions) ? body.sessions : []).flatMap((raw) => {
				const session = parseSession(raw);
				return session === void 0 ? [] : [session];
			});
			this.applySessions(sessions);
			await this.refreshTree();
		} catch {
			this.store.update((draft) => {
				draft.error = true;
			});
		} finally {
			this.refreshing = false;
		}
	}
	/**
	* Read the selected session's node tree.
	*
	* Polled with the session list so the panel shows the live hierarchy; a lost
	* session or a host without the route leaves the tree empty rather than
	* reporting an error the user cannot act on.
	*/
	async refreshTree() {
		const state = this.store.getSnapshot();
		if (!state.open) {
			this.store.update((draft) => {
				draft.tree = null;
				draft.treeError = null;
			});
			return;
		}
		const session = state.sessions.find((item) => item.sessionId === state.selected);
		if (session === void 0 || session.state === "lost") {
			this.store.update((draft) => {
				draft.tree = null;
				draft.treeError = null;
			});
			return;
		}
		try {
			const response = await this.fetchImpl(`${TREE_PATH}?session=${encodeURIComponent(session.sessionId)}`, { headers: { accept: "application/json" } });
			if (!response.ok) throw new Error(`tree ${response.status}`);
			const body = await response.json();
			if (body.ok !== true) {
				const reason = typeof body.error === "string" ? body.error : "no-tree";
				this.store.update((draft) => {
					draft.tree = null;
					draft.treeError = reason;
				});
				return;
			}
			const nodes = (Array.isArray(body.nodes) ? body.nodes : []).flatMap((raw) => {
				const node = parseTreeNode(raw);
				return node === void 0 ? [] : [node];
			});
			this.store.update((draft) => {
				draft.tree = nodes;
				draft.treeError = null;
			});
		} catch {
			this.store.update((draft) => {
				draft.tree = null;
				draft.treeError = "tree-unavailable";
			});
		}
	}
	/** Ask the game for one node's properties. */
	async fetchNode(sessionId, path) {
		try {
			const response = await this.fetchImpl(`${NODE_PATH}?session=${encodeURIComponent(sessionId)}&path=${encodeURIComponent(path)}`, { headers: { accept: "application/json" } });
			if (!response.ok) throw new Error(`node ${response.status}`);
			const body = await response.json();
			if (body.ok !== true) {
				this.store.update((draft) => {
					draft.nodeDetail = {
						path,
						className: "",
						scene: "",
						props: [],
						total: 0,
						error: typeof body.error === "string" ? body.error : "node-unavailable"
					};
				});
				return;
			}
			const props = (Array.isArray(body.props) ? body.props : []).flatMap((raw) => {
				if (typeof raw !== "object" || raw === null) return [];
				const record = raw;
				if (typeof record.name !== "string" || typeof record.value !== "string") return [];
				return [{
					name: record.name,
					value: record.value,
					...typeof record.type === "string" ? { type: record.type } : {}
				}];
			});
			this.store.update((draft) => {
				if (draft.selectedNode !== path) return;
				draft.nodeDetail = {
					path,
					className: typeof body.className === "string" ? body.className : "",
					scene: typeof body.scene === "string" ? body.scene : "",
					props,
					total: typeof body.total === "number" ? body.total : props.length,
					error: null
				};
			});
		} catch {
			this.store.update((draft) => {
				if (draft.selectedNode !== path) return;
				draft.nodeDetail = {
					path,
					className: "",
					scene: "",
					props: [],
					total: 0,
					error: "node-unavailable"
				};
			});
		}
	}
	/** Replace the session list, keeping or repairing the selection. */
	applySessions(sessions) {
		this.store.update((draft) => {
			const previous = draft.selected;
			draft.sessions = sessions;
			draft.error = false;
			if (draft.selected !== void 0 && !sessions.some((session) => session.sessionId === draft.selected)) draft.selected = void 0;
			if (draft.selected === void 0) draft.selected = sessions[0]?.sessionId;
			if (draft.selected !== previous) {
				draft.selectedNode = void 0;
				draft.nodeDetail = null;
			}
		});
	}
	/** Open or close the panel. */
	toggle() {
		this.store.update((draft) => {
			draft.open = !draft.open;
		});
		if (this.store.getSnapshot().open) this.refresh();
	}
	/** Close the panel. */
	close() {
		this.store.update((draft) => {
			draft.open = false;
		});
	}
	/**
	* Select one session.
	* @param sessionId - the session id to show.
	*/
	select(sessionId) {
		this.store.update((draft) => {
			if (draft.selected !== sessionId) {
				draft.selectedNode = void 0;
				draft.nodeDetail = null;
			}
			draft.selected = sessionId;
		});
		this.refreshTree();
	}
	/**
	* Forward one click in game coordinates.
	* @param x - viewport x in game pixels.
	* @param y - viewport y in game pixels.
	*/
	click(x, y) {
		const sessionId = this.store.getSnapshot().selected;
		if (sessionId === void 0) return;
		(async () => {
			try {
				const response = await this.fetchImpl(INPUT_PATH, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						session: sessionId,
						x,
						y
					})
				});
				if (!response.ok) throw new Error(`input ${response.status}`);
			} catch {
				this.store.update((draft) => {
					draft.error = true;
				});
			}
		})();
	}
	/**
	* Read one node's properties into the detail pane.
	* @param path - the node's address, as the tree shows it.
	*/
	selectNode(path) {
		const sessionId = this.store.getSnapshot().selected;
		this.store.update((draft) => {
			draft.selectedNode = path;
			if (path === void 0) draft.nodeDetail = null;
		});
		if (path === void 0 || sessionId === void 0) return;
		this.fetchNode(sessionId, path);
	}
	/**
	* Build the face the slot registration injects.
	* @returns the panel snapshot and its actions.
	*/
	inject() {
		return {
			hooks: { watch: this.store },
			toggle: () => {
				this.toggle();
			},
			close: () => {
				this.close();
			},
			select: (sessionId) => {
				this.select(sessionId);
			},
			selectNode: (path) => {
				this.selectNode(path);
			},
			click: (x, y) => {
				this.click(x, y);
			}
		};
	}
};

//#endregion
//#region \0godot-css:D:/projects/dsh-godot/ui-godot/src/client/GodotWatch.module.css.mjs
const css = ".godot_GodotWatch_module_css_layer {\r\n  position: fixed;\r\n  inset: 0;\r\n  z-index: 60;\r\n  pointer-events: none;\r\n}\r\n\r\n.godot_GodotWatch_module_css_panel {\r\n  position: absolute;\r\n  pointer-events: auto;\r\n  /* Width comes from the component (one source, also used for placement and\r\n     viewport clamping); this caps it on a narrow viewport. */\r\n  max-width: calc(100vw - 48px);\r\n  max-height: calc(100vh - 32px);\r\n  display: flex;\r\n  flex-direction: column;\r\n  border: 1px solid var(--dsw-alias-border-l2);\r\n  border-radius: 12px;\r\n  background: var(--dsw-alias-bg-layer-3);\r\n  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);\r\n  overflow: hidden;\r\n}\r\n\r\n.godot_GodotWatch_module_css_head {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 8px;\r\n  padding: 10px 12px;\r\n  border-bottom: 1px solid var(--dsw-alias-border-l2);\r\n  cursor: grab;\r\n  user-select: none;\r\n  touch-action: none;\r\n}\r\n\r\n.godot_GodotWatch_module_css_dragging,\r\n.godot_GodotWatch_module_css_dragging .godot_GodotWatch_module_css_head {\r\n  cursor: grabbing;\r\n}\r\n\r\n.godot_GodotWatch_module_css_headLogo {\r\n  width: 18px;\r\n  height: 18px;\r\n  object-fit: contain;\r\n  flex: none;\r\n  pointer-events: none;\r\n}\r\n\r\n.godot_GodotWatch_module_css_title {\r\n  font: var(--dsw-font-s-strong-14);\r\n  color: var(--dsw-alias-label-primary);\r\n}\r\n\r\n.godot_GodotWatch_module_css_meta {\r\n  font: var(--dsw-font-xs-13);\r\n  color: var(--dsw-alias-label-tertiary);\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n  white-space: nowrap;\r\n  flex: 1;\r\n}\r\n\r\n.godot_GodotWatch_module_css_close {\r\n  border: none;\r\n  background: transparent;\r\n  color: var(--dsw-alias-label-secondary);\r\n  font-size: 18px;\r\n  line-height: 1;\r\n  cursor: pointer;\r\n  padding: 2px 4px;\r\n  border-radius: 4px;\r\n}\r\n\r\n.godot_GodotWatch_module_css_close:hover {\r\n  background: var(--dsw-alias-bg-layer-2);\r\n  color: var(--dsw-alias-label-primary);\r\n}\r\n\r\n.godot_GodotWatch_module_css_body {\r\n  padding: 10px 12px 12px;\r\n  flex: 1 1 auto;\r\n  min-height: 0;\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 6px;\r\n}\r\n\r\n.godot_GodotWatch_module_css_frame {\r\n  display: block;\r\n  width: 100%;\r\n  height: 100%;\r\n  object-fit: contain;\r\n  background: var(--dsw-alias-bg-layer-2);\r\n  border-radius: 8px;\r\n  cursor: crosshair;\r\n}\r\n\r\n.godot_GodotWatch_module_css_note {\r\n  margin: 4px 0;\r\n  font: var(--dsw-font-xs-13);\r\n  color: var(--dsw-alias-label-secondary);\r\n  line-height: 1.5;\r\n}\r\n\r\n.godot_GodotWatch_module_css_hint {\r\n  flex: none;\r\n  margin: 8px 0 0;\r\n  font: var(--dsw-font-xs-13);\r\n  color: var(--dsw-alias-label-tertiary);\r\n}\r\n\r\n.godot_GodotWatch_module_css_ball {\r\n  pointer-events: auto;\r\n  position: absolute;\r\n  width: 52px;\r\n  height: 52px;\r\n  border-radius: 50%;\r\n  border: 1px solid rgba(0, 0, 0, 0.12);\r\n  background: #fff;\r\n  color: #fff;\r\n  cursor: grab;\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: center;\r\n  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3);\r\n  transition: transform 120ms ease;\r\n  touch-action: none;\r\n  user-select: none;\r\n}\r\n\r\n.godot_GodotWatch_module_css_ball:hover {\r\n  transform: scale(1.06);\r\n}\r\n\r\n.godot_GodotWatch_module_css_ball.godot_GodotWatch_module_css_dragging {\r\n  cursor: grabbing;\r\n  transform: scale(1.04);\r\n}\r\n\r\n.godot_GodotWatch_module_css_mark {\r\n  width: 38px;\r\n  height: 38px;\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: center;\r\n  pointer-events: none;\r\n}\r\n\r\n.godot_GodotWatch_module_css_ballLogo {\r\n  width: 100%;\r\n  height: 100%;\r\n  object-fit: contain;\r\n  pointer-events: none;\r\n}\r\n\r\n.godot_GodotWatch_module_css_status {\r\n  width: 8px;\r\n  height: 8px;\r\n  border-radius: 50%;\r\n  flex: none;\r\n  background: var(--dsw-alias-label-tertiary);\r\n}\r\n\r\n.godot_GodotWatch_module_css_badge {\r\n  position: absolute;\r\n  right: 2px;\r\n  bottom: 2px;\r\n  width: 10px;\r\n  height: 10px;\r\n  border: 2px solid #fff;\r\n}\r\n\r\n.godot_GodotWatch_module_css_ready {\r\n  background: #3fb950;\r\n}\r\n\r\n.godot_GodotWatch_module_css_idle {\r\n  background: var(--dsw-alias-label-tertiary);\r\n}\r\n\r\n.godot_GodotWatch_module_css_lost {\r\n  background: #d29922;\r\n}\r\n\r\n.godot_GodotWatch_module_css_error {\r\n  background: #f85149;\r\n}\r\n\r\n/* Two panes under the header: the node tree, and the frame with the picked\r\n   node's properties — the same reading order the `.godot_GodotWatch_module_css_tscn` preview uses. */\r\n/* The preview column decides the height; the tree is a sidebar that stretches\r\n   beside it and scrolls inside that height, the way an IDE docks a panel. */\r\n.godot_GodotWatch_module_css_stage {\r\n  display: flex;\r\n  align-items: stretch;\r\n  gap: 12px;\r\n  flex: 1 1 auto;\r\n  min-height: 0;\r\n}\r\n\r\n.godot_GodotWatch_module_css_column {\r\n  flex: 1 1 auto;\r\n  min-width: 0;\r\n  min-height: 0;\r\n  display: flex;\r\n  flex-direction: column;\r\n  gap: 8px;\r\n}\r\n\r\n/* The preview is the elastic half of the split: dragging the divider below it\r\n   takes height from the picture instead of growing the panel. */\r\n.godot_GodotWatch_module_css_framePane {\r\n  flex: 1 1 0;\r\n  min-width: 0;\r\n  min-height: 120px;\r\n}\r\n\r\n.godot_GodotWatch_module_css_detailPane {\r\n  position: relative;\r\n  flex: 0 0 auto;\r\n  height: var(--detail-h, 180px);\r\n  display: flex;\r\n  flex-direction: column;\r\n  border-top: 1px solid var(--dsw-alias-border-l2);\r\n  padding-top: 6px;\r\n  min-height: 0;\r\n  overflow: hidden;\r\n}\r\n\r\n/* Folded: the pane keeps its title and gives the rest of its height back. */\r\n.godot_GodotWatch_module_css_detailPaneCollapsed {\r\n  position: relative;\r\n  flex: 0 0 auto;\r\n  border-top: 1px solid var(--dsw-alias-border-l2);\r\n  padding-top: 6px;\r\n  overflow: visible;\r\n}\r\n\r\n/* A pane's own toolbar row: clicking the title folds the pane away. It spans the\r\n   row and reads from the left, like a dock header — no chip, folded or not. */\r\n.godot_GodotWatch_module_css_paneToggle {\r\n  display: flex;\r\n  align-items: center;\r\n  gap: 4px;\r\n  width: 100%;\r\n  padding: 0 0 4px;\r\n  border: 0;\r\n  background: none;\r\n  cursor: pointer;\r\n  text-align: left;\r\n  color: var(--dsw-alias-label-secondary);\r\n  font: var(--dsw-font-xs-13);\r\n}\r\n\r\n.godot_GodotWatch_module_css_paneToggle:hover {\r\n  color: var(--dsw-alias-label-primary);\r\n}\r\n\r\n/* The tree's fold control: the shell's own panel-left glyph, at the left of the\r\n   title bar, so it reads as \"this panel\" rather than a filter chip. */\r\n/* Same metrics as the shell's own header icon button (ui-sidebar\r\n   .godot_GodotWatch_module_css_iconButton): 28 px box, its radius token, its hover token. */\r\n.godot_GodotWatch_module_css_treeToggle {\r\n  display: inline-flex;\r\n  align-items: center;\r\n  justify-content: center;\r\n  width: 28px;\r\n  height: 28px;\r\n  flex: none;\r\n  padding: 0;\r\n  border: 0;\r\n  border-radius: var(--dsw-radius-sm);\r\n  background: transparent;\r\n  color: var(--dsw-alias-label-secondary);\r\n  cursor: pointer;\r\n}\r\n\r\n/* The tree's own toolbar: the pane's title on the left, its fold control at the\r\n   right edge, where a side panel's collapse belongs. It spans the pane and stays\r\n   put while the rows below scroll. */\r\n.godot_GodotWatch_module_css_treeHead {\r\n  display: flex;\r\n  align-items: center;\r\n  justify-content: space-between;\r\n  gap: 6px;\r\n  padding-bottom: 4px;\r\n  flex: none;\r\n}\r\n\r\n.godot_GodotWatch_module_css_treeTitle {\r\n  color: var(--dsw-alias-label-tertiary);\r\n  font: var(--dsw-font-xs-13);\r\n}\r\n\r\n/* The scrolling region under a pane's header. */\r\n.godot_GodotWatch_module_css_treeBody,\r\n.godot_GodotWatch_module_css_detailBody {\r\n  flex: 1 1 auto;\r\n  min-height: 0;\r\n  overflow-y: auto;\r\n  overflow-x: hidden;\r\n}\r\n\r\n@media (hover: hover) {\r\n  .godot_GodotWatch_module_css_treeToggle:hover {\r\n    background: var(--dsw-alias-interactive-bg-hover);\r\n  }\r\n}\r\n\r\n.godot_GodotWatch_module_css_treeToggle:focus-visible {\r\n  outline: none;\r\n  box-shadow: inset 0 0 0 1px var(--dsw-alias-label-tertiary);\r\n}\r\n\r\n.godot_GodotWatch_module_css_chevron {\r\n  display: inline-block;\r\n  width: 10px;\r\n  color: var(--dsw-alias-label-tertiary);\r\n}\r\n\r\n/* The detail header keeps its own bottom gap, folded or open. */\r\n.godot_GodotWatch_module_css_detailPane .godot_GodotWatch_module_css_paneToggle,\r\n.godot_GodotWatch_module_css_detailPaneCollapsed .godot_GodotWatch_module_css_paneToggle {\r\n  margin-bottom: 4px;\r\n}\r\n\r\n.godot_GodotWatch_module_css_treePane {\r\n  position: relative;\r\n  flex: 0 0 var(--tree-w, 280px);\r\n  display: flex;\r\n  flex-direction: column;\r\n  overflow: hidden;\r\n  border-right: 1px solid var(--dsw-alias-border-l2);\r\n  padding-right: 8px;\r\n  min-height: 0;\r\n}\r\n\r\n.godot_GodotWatch_module_css_rail {\r\n  flex: 0 0 32px;\r\n  display: flex;\r\n  /* Top-aligned, horizontally centred: the control sits where the pane header\r\n     sat, not in the middle of the panel. */\r\n  align-items: flex-start;\r\n  justify-content: center;\r\n  padding-top: 2px;\r\n  border-right: 1px solid var(--dsw-alias-border-l2);\r\n}\r\n\r\n.godot_GodotWatch_module_css_detailHead {\r\n  display: flex;\r\n  gap: 8px;\r\n  align-items: baseline;\r\n  color: var(--dsw-alias-label-primary);\r\n  font: var(--dsw-font-xs-13);\r\n}\r\n\r\n.godot_GodotWatch_module_css_props {\r\n  margin: 4px 0 0;\r\n  padding: 0;\r\n  list-style: none;\r\n  font: var(--dsw-font-xs-13);\r\n}\r\n\r\n.godot_GodotWatch_module_css_props li {\r\n  display: flex;\r\n  gap: 6px;\r\n  padding: 1px 0;\r\n}\r\n\r\n.godot_GodotWatch_module_css_propName {\r\n  color: var(--dsw-alias-label-tertiary);\r\n  flex: none;\r\n}\r\n\r\n.godot_GodotWatch_module_css_propValue {\r\n  font-family: var(--dsw-font-family-mono);\r\n  color: var(--dsw-alias-label-primary);\r\n  overflow: hidden;\r\n  text-overflow: ellipsis;\r\n}\r\n\r\n/* Splitter strips: a thin hit area on the pane edge, highlighted on hover. */\r\n.godot_GodotWatch_module_css_splitterX,\r\n.godot_GodotWatch_module_css_splitterY {\r\n  position: absolute;\r\n  background: transparent;\r\n  z-index: 2;\r\n  touch-action: none;\r\n  user-select: none;\r\n}\r\n\r\n.godot_GodotWatch_module_css_splitterX {\r\n  top: 0;\r\n  bottom: 0;\r\n  right: -5px;\r\n  width: 10px;\r\n  cursor: col-resize;\r\n}\r\n\r\n.godot_GodotWatch_module_css_splitterY {\r\n  left: 0;\r\n  right: 0;\r\n  top: -5px;\r\n  height: 10px;\r\n  cursor: row-resize;\r\n}\r\n\r\n.godot_GodotWatch_module_css_splitterX:hover,\r\n.godot_GodotWatch_module_css_splitterY:hover,\r\n.godot_GodotWatch_module_css_splitterX:focus-visible,\r\n.godot_GodotWatch_module_css_splitterY:focus-visible {\r\n  background: var(--dsw-alias-border-l2);\r\n  outline: none;\r\n}\r\n\r\n.godot_GodotWatch_module_css_splitterX:focus-visible,\r\n.godot_GodotWatch_module_css_splitterY:focus-visible {\r\n  background: var(--dsw-alias-label-tertiary);\r\n}\r\n";
const tag = "ui-godot:GodotWatch.module.css";
if (typeof document !== "undefined" && document.getElementById(tag) === null) {
	const style = document.createElement("style");
	style.id = tag;
	style.dataset.plugin = "ui-godot";
	style.textContent = css;
	document.head.appendChild(style);
}
var GodotWatch_module_css_default = {
	"layer": "godot_GodotWatch_module_css_layer",
	"panel": "godot_GodotWatch_module_css_panel",
	"head": "godot_GodotWatch_module_css_head",
	"dragging": "godot_GodotWatch_module_css_dragging",
	"headLogo": "godot_GodotWatch_module_css_headLogo",
	"title": "godot_GodotWatch_module_css_title",
	"meta": "godot_GodotWatch_module_css_meta",
	"close": "godot_GodotWatch_module_css_close",
	"body": "godot_GodotWatch_module_css_body",
	"frame": "godot_GodotWatch_module_css_frame",
	"note": "godot_GodotWatch_module_css_note",
	"hint": "godot_GodotWatch_module_css_hint",
	"ball": "godot_GodotWatch_module_css_ball",
	"mark": "godot_GodotWatch_module_css_mark",
	"ballLogo": "godot_GodotWatch_module_css_ballLogo",
	"status": "godot_GodotWatch_module_css_status",
	"badge": "godot_GodotWatch_module_css_badge",
	"ready": "godot_GodotWatch_module_css_ready",
	"idle": "godot_GodotWatch_module_css_idle",
	"lost": "godot_GodotWatch_module_css_lost",
	"error": "godot_GodotWatch_module_css_error",
	"tscn": "godot_GodotWatch_module_css_tscn",
	"stage": "godot_GodotWatch_module_css_stage",
	"column": "godot_GodotWatch_module_css_column",
	"framePane": "godot_GodotWatch_module_css_framePane",
	"detailPane": "godot_GodotWatch_module_css_detailPane",
	"detailPaneCollapsed": "godot_GodotWatch_module_css_detailPaneCollapsed",
	"paneToggle": "godot_GodotWatch_module_css_paneToggle",
	"iconButton": "godot_GodotWatch_module_css_iconButton",
	"treeToggle": "godot_GodotWatch_module_css_treeToggle",
	"treeHead": "godot_GodotWatch_module_css_treeHead",
	"treeTitle": "godot_GodotWatch_module_css_treeTitle",
	"treeBody": "godot_GodotWatch_module_css_treeBody",
	"detailBody": "godot_GodotWatch_module_css_detailBody",
	"chevron": "godot_GodotWatch_module_css_chevron",
	"treePane": "godot_GodotWatch_module_css_treePane",
	"rail": "godot_GodotWatch_module_css_rail",
	"detailHead": "godot_GodotWatch_module_css_detailHead",
	"props": "godot_GodotWatch_module_css_props",
	"propName": "godot_GodotWatch_module_css_propName",
	"propValue": "godot_GodotWatch_module_css_propValue",
	"splitterX": "godot_GodotWatch_module_css_splitterX",
	"splitterY": "godot_GodotWatch_module_css_splitterY"
};

//#endregion
//#region src/client/GodotWatch.tsx
/** Ball edge in pixels. */
const BALL = 52;
/** Gap between the snapped panel and the ball. */
const GAP = 12;
/** Minimum distance from a viewport edge. */
const MARGIN = 8;
/** Panel width; height is measured after render. */
const PANEL_WIDTH = 920;
/** Panel height: the split between preview and details needs a definite box. */
const PANEL_HEIGHT = 720;
/** Persisted ball and panel positions. */
const BALL_KEY = "dsh.godot.watch.pos";
const PANEL_KEY = "dsh.godot.watch.panelPos";
const TREE_KEY = "dsh.godot.watch.treeWidth";
const DETAIL_KEY = "dsh.godot.watch.detailHeight";
/** Read a stored position, dropping malformed entries. */
function loadPosition(key) {
	try {
		const raw = window.localStorage.getItem(key);
		if (raw === null) return void 0;
		const parsed = JSON.parse(raw);
		if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return void 0;
		if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return void 0;
		return {
			x: parsed.x,
			y: parsed.y
		};
	} catch {
		return;
	}
}
/** Persist a position best-effort. */
function savePosition(key, position) {
	try {
		window.localStorage.setItem(key, JSON.stringify(position));
	} catch {}
}
/** Read a stored pane size, dropping anything unusable. */
function loadSize(key) {
	try {
		const raw = window.localStorage.getItem(key);
		if (raw === null) return void 0;
		const value = Number(raw);
		return Number.isFinite(value) ? value : void 0;
	} catch {
		return;
	}
}
/** Persist a pane size best-effort. */
function saveSize(key, value) {
	try {
		window.localStorage.setItem(key, String(Math.round(value)));
	} catch {}
}
/** Keep a box fully inside the viewport. */
function clampToViewport(position, width, height) {
	return {
		x: Math.max(MARGIN, Math.min(window.innerWidth - width - MARGIN, position.x)),
		y: Math.max(MARGIN, Math.min(window.innerHeight - height - MARGIN, position.y))
	};
}
/** The ball's first position: bottom-right, clear of the composer. */
function defaultBallPosition() {
	return {
		x: window.innerWidth - 18 - BALL,
		y: window.innerHeight - 104 - BALL
	};
}
/** A floating box that can be dragged and persists where the user left it. */
function useFloatingBox(size, storageKey, initial) {
	const [position, setPosition] = (0, react.useState)(() => clampToViewport(loadPosition(storageKey) ?? initial, size.w, size.h));
	const [dragging, setDragging] = (0, react.useState)(false);
	const positionRef = (0, react.useRef)(position);
	positionRef.current = position;
	const drag = (0, react.useRef)(void 0);
	const moved = (0, react.useRef)(false);
	const onPointerDown = (event) => {
		if (event.button !== 0) return;
		const interactive = event.target.closest("button, a, input, [role=\"button\"]");
		if (interactive !== null && interactive !== event.currentTarget) return;
		drag.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			baseX: positionRef.current.x,
			baseY: positionRef.current.y
		};
		moved.current = false;
		setDragging(true);
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {}
		event.preventDefault();
	};
	const onPointerMove = (event) => {
		const current = drag.current;
		if (current === void 0 || event.pointerId !== current.pointerId) return;
		const dx = event.clientX - current.startX;
		const dy = event.clientY - current.startY;
		if (!moved.current && Math.abs(dx) + Math.abs(dy) > 5) moved.current = true;
		if (!moved.current) return;
		const next = clampToViewport({
			x: current.baseX + dx,
			y: current.baseY + dy
		}, size.w, size.h);
		positionRef.current = next;
		setPosition(next);
	};
	const onPointerUp = (event) => {
		const current = drag.current;
		if (current === void 0 || event.pointerId !== current.pointerId) return;
		drag.current = void 0;
		setDragging(false);
		try {
			event.currentTarget.releasePointerCapture(event.pointerId);
		} catch {}
		if (moved.current) savePosition(storageKey, positionRef.current);
	};
	/** Whether the last gesture moved the box; a click after a drag is ignored. */
	const consumeMoved = () => {
		const wasMoved = moved.current;
		moved.current = false;
		return wasMoved;
	};
	return {
		position,
		setPosition,
		dragging,
		consumeMoved,
		handlers: {
			onPointerDown,
			onPointerMove,
			onPointerUp,
			onPointerCancel: onPointerUp
		}
	};
}
/** Map one session state to its short localized label. */
function stateLabel(session, t) {
	if (session.state === "ready") return t("watchRunning");
	if (session.state === "lost") return t("watchLost");
	return session.state;
}
/**
* Adapt one live tree node to a tree row.
*
* The sandbox bridge reports the engine class even for a scripted node, so the
* icon is the class icon and the scene file (when the node came from one)
* travels in the tooltip.
* @param node - the host's node projection.
* @returns the row model, with its children.
*/
function toModel(node, parent = "") {
	const path = parent === "" ? node.name : `${parent}/${node.name}`;
	const title = [
		node.name,
		node.className,
		node.scene !== "" ? node.scene : `id ${node.id}`
	].filter((part) => part !== "").join("\n");
	return {
		key: `${node.id}:${node.name}`,
		name: node.name,
		subtitle: node.className,
		iconClass: node.className,
		title,
		path,
		...node.unique ? { unique: true } : {},
		...node.script !== "" ? { script: node.script } : {},
		children: node.children.map((child) => toModel(child, path))
	};
}
/** The row key of the node at one address, found by walking the tree. */
function selectedRowKey(nodes, path, parent = "") {
	if (path === void 0) return void 0;
	for (const node of nodes) {
		const here = parent === "" ? node.name : `${parent}/${node.name}`;
		if (here === path) return `${node.id}:${node.name}`;
		const inner = selectedRowKey(node.children, path, here);
		if (inner !== void 0) return inner;
	}
}
/**
* Hold a drag size inside its bounds. */
function clampPaneSize(value, min, max) {
	return Math.min(Math.max(value, min), max);
}
/**
* One draggable pane size, applied as a CSS custom property.
*
* The drag writes the property straight to the element instead of going through
* React state: a scene tree of a few hundred rows re-rendering on every pointer
* move makes the pane the preview shares lag behind the splitter.
* @param initial - starting size in pixels.
* @param min - smallest allowed size.
* @param max - largest allowed size.
* @param axis - `x` grows with the pointer (a sidebar), `y` grows against it (a bottom pane).
* @param property - the custom property to set on `target`.
* @param target - the element that owns the layout (the stage or the pane).
* @returns the handlers to spread on the splitter.
*/
function usePaneSize(initial, min, max, axis, property, target, storageKey) {
	const drag = (0, react.useRef)(void 0);
	const sizeRef = (0, react.useRef)(clampPaneSize(loadSize(storageKey) ?? initial, min, max));
	const apply$1 = (value) => {
		sizeRef.current = clampPaneSize(value, min, max);
		target.current?.style.setProperty(property, `${sizeRef.current}px`);
	};
	(0, react.useEffect)(() => {
		apply$1(sizeRef.current);
	}, [target]);
	const onPointerDown = (event) => {
		if (event.button !== 0) return;
		drag.current = {
			pointerId: event.pointerId,
			start: axis === "x" ? event.clientX : event.clientY,
			base: sizeRef.current
		};
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {}
		event.preventDefault();
		event.stopPropagation();
	};
	const onPointerMove = (event) => {
		const current = drag.current;
		if (current === void 0 || event.pointerId !== current.pointerId) return;
		const delta = (axis === "x" ? event.clientX : event.clientY) - current.start;
		apply$1(current.base + (axis === "x" ? delta : -delta));
	};
	const onPointerUp = (event) => {
		if (drag.current?.pointerId !== event.pointerId) return;
		drag.current = void 0;
		saveSize(storageKey, sizeRef.current);
		try {
			event.currentTarget.releasePointerCapture(event.pointerId);
		} catch {}
	};
	const onDoubleClick = () => {
		apply$1(initial);
		saveSize(storageKey, sizeRef.current);
	};
	/**
	* Keyboard sizing, for a pane nobody can drag: arrows move by 8 px (24 with
	* Shift), Home and End go to the bounds.
	*/
	const onKeyDown = (event) => {
		const step = event.shiftKey ? 24 : 8;
		const grow = axis === "x" ? "ArrowRight" : "ArrowUp";
		const shrink = axis === "x" ? "ArrowLeft" : "ArrowDown";
		let next;
		if (event.key === grow) next = sizeRef.current + step;
		else if (event.key === shrink) next = sizeRef.current - step;
		else if (event.key === "Home") next = min;
		else if (event.key === "End") next = max;
		else return;
		event.preventDefault();
		apply$1(next);
		saveSize(storageKey, sizeRef.current);
	};
	return { handlers: {
		onPointerDown,
		onPointerMove,
		onPointerUp,
		onPointerCancel: onPointerUp,
		onDoubleClick,
		onKeyDown
	} };
}
/** Render the fixed watch ball and, when open, the live panel. */
function GodotWatch({ useWatch, toggle, close, click, selectNode, t }) {
	const state = useWatch((snapshot) => snapshot);
	const session = state.sessions.find((item) => item.sessionId === state.selected) ?? state.sessions[0];
	const ball = useFloatingBox({
		w: BALL,
		h: BALL
	}, BALL_KEY, defaultBallPosition());
	const panel = useFloatingBox({
		w: PANEL_WIDTH,
		h: PANEL_HEIGHT
	}, PANEL_KEY, {
		x: 0,
		y: 0
	});
	const [treeOpen, setTreeOpen] = (0, react.useState)(true);
	const [detailOpen, setDetailOpen] = (0, react.useState)(true);
	const stageRef = (0, react.useRef)(null);
	const detailRef = (0, react.useRef)(null);
	const treeSize = usePaneSize(280, 160, 460, "x", "--tree-w", stageRef, TREE_KEY);
	const detailSize = usePaneSize(180, 80, 420, "y", "--detail-h", detailRef, DETAIL_KEY);
	const panelRef = (0, react.useRef)(null);
	const ballRef = (0, react.useRef)(ball.position);
	ballRef.current = ball.position;
	(0, react.useLayoutEffect)(() => {
		if (!state.open || panelRef.current === null) return;
		const element = panelRef.current;
		const width = element.offsetWidth > 0 ? element.offsetWidth : PANEL_WIDTH;
		const height = element.offsetHeight > 0 ? element.offsetHeight : PANEL_HEIGHT;
		const anchor = ballRef.current;
		const x = anchor.x + BALL - width;
		let y = anchor.y - height - GAP;
		if (y < MARGIN) y = anchor.y + BALL + GAP;
		panel.setPosition(clampToViewport({
			x,
			y
		}, width, height));
	}, [
		state.open,
		session?.sessionId,
		state.error,
		state.sessions.length,
		panel.setPosition
	]);
	(0, react.useEffect)(() => {
		const onResize = () => {
			ball.setPosition((current) => clampToViewport(current, BALL, BALL));
			const element = panelRef.current;
			panel.setPosition((current) => clampToViewport(current, element?.offsetWidth ?? PANEL_WIDTH, element?.offsetHeight ?? PANEL_HEIGHT));
		};
		window.addEventListener("resize", onResize);
		return () => {
			window.removeEventListener("resize", onResize);
		};
	}, [ball.setPosition, panel.setPosition]);
	const dot = state.error ? GodotWatch_module_css_default.error : session === void 0 ? GodotWatch_module_css_default.idle : session.state === "ready" ? GodotWatch_module_css_default.ready : GodotWatch_module_css_default.lost;
	const onFrameClick = (event) => {
		/* v8 ignore next -- the image renders only when a session exists */
		if (session === void 0) return;
		const image = event.currentTarget;
		const rect = image.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return;
		const width = session.window?.[0] ?? image.naturalWidth;
		const height = session.window?.[1] ?? image.naturalHeight;
		if (width <= 0 || height <= 0) return;
		click((event.clientX - rect.left) / rect.width * width, (event.clientY - rect.top) / rect.height * height);
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: GodotWatch_module_css_default.layer,
		children: [state.open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
			ref: panelRef,
			className: GodotWatch_module_css_default.panel,
			style: {
				left: `${panel.position.x}px`,
				top: `${panel.position.y}px`,
				width: `${PANEL_WIDTH}px`,
				height: `${PANEL_HEIGHT}px`
			},
			"aria-label": t("watchTitle"),
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
				className: `${GodotWatch_module_css_default.head} ${panel.dragging ? GodotWatch_module_css_default.dragging : ""}`,
				...panel.handlers,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
						className: GodotWatch_module_css_default.headLogo,
						src: godot_logo_svg_default,
						alt: "",
						draggable: false
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: `${GodotWatch_module_css_default.status} ${dot}`,
						"aria-hidden": "true"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: GodotWatch_module_css_default.title,
						children: t("watchTitle")
					}),
					session !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: GodotWatch_module_css_default.meta,
						children: [
							session.sessionId.slice(0, 8),
							" · ",
							stateLabel(session, t)
						]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: GodotWatch_module_css_default.close,
						"aria-label": t("watchClose"),
						onClick: close,
						children: "×"
					})
				]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: GodotWatch_module_css_default.body,
				children: state.error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: GodotWatch_module_css_default.note,
					children: t("watchError")
				}) : session === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: GodotWatch_module_css_default.note,
					children: t("watchIdle")
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					ref: stageRef,
					className: GodotWatch_module_css_default.stage,
					children: [
						!treeOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: GodotWatch_module_css_default.rail,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.Tooltip, {
								label: t("watchTreeShow"),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: GodotWatch_module_css_default.treeToggle,
									"aria-label": t("watchTreeShow"),
									"aria-expanded": false,
									onClick: () => {
										setTreeOpen(true);
									},
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.IconPanelLeftOutlineRegular, {})
								})
							})
						}),
						treeOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
							className: GodotWatch_module_css_default.treePane,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: GodotWatch_module_css_default.treeHead,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: GodotWatch_module_css_default.treeTitle,
										children: t("watchTree")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.Tooltip, {
										label: t("watchTreeHide"),
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: GodotWatch_module_css_default.treeToggle,
											"aria-label": t("watchTreeHide"),
											"aria-expanded": true,
											onClick: () => {
												setTreeOpen(false);
											},
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(__deepseek_ai_dsh_client_ui_primitives.IconPanelLeftOutlineRegular, {})
										})
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: GodotWatch_module_css_default.splitterX,
									role: "separator",
									tabIndex: 0,
									"aria-orientation": "vertical",
									"aria-label": t("watchResizeTree"),
									...treeSize.handlers
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: GodotWatch_module_css_default.treeBody,
									children: [state.treeError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: GodotWatch_module_css_default.note,
										children: state.treeError
									}), state.tree !== null && state.tree.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NodeTree, {
										roots: state.tree.map((root) => toModel(root)),
										selected: selectedRowKey(state.tree, state.selectedNode),
										onSelect: (node) => {
											selectNode(node.path);
										},
										t
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: GodotWatch_module_css_default.note,
										children: t("watchTreeEmpty")
									})]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: GodotWatch_module_css_default.column,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: GodotWatch_module_css_default.framePane,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
									className: GodotWatch_module_css_default.frame,
									src: watchStreamUrl(session.sessionId),
									alt: t("watchLive"),
									onClick: onFrameClick
								})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								ref: detailRef,
								className: detailOpen ? GodotWatch_module_css_default.detailPane : GodotWatch_module_css_default.detailPaneCollapsed,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: GodotWatch_module_css_default.splitterY,
										role: "separator",
										tabIndex: 0,
										"aria-orientation": "horizontal",
										"aria-label": t("watchResizeDetail"),
										...detailSize.handlers
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: GodotWatch_module_css_default.paneToggle,
										"aria-expanded": detailOpen,
										onClick: () => {
											setDetailOpen(!detailOpen);
										},
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: GodotWatch_module_css_default.chevron,
												"aria-hidden": "true",
												children: detailOpen ? "▾" : "▸"
											}),
											t("watchDetail"),
											state.nodeDetail === null ? "" : ` · ${state.nodeDetail.path}`
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: GodotWatch_module_css_default.detailBody,
										children: !detailOpen ? null : state.nodeDetail === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: GodotWatch_module_css_default.note,
											children: t("watchPickNode")
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: GodotWatch_module_css_default.detailHead,
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: state.nodeDetail.path }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: GodotWatch_module_css_default.meta,
													children: state.nodeDetail.className
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: GodotWatch_module_css_default.meta,
													children: [
														state.nodeDetail.props.length,
														"/",
														state.nodeDetail.total
													]
												})
											]
										}), state.nodeDetail.error !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: GodotWatch_module_css_default.note,
											children: state.nodeDetail.error
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
											className: GodotWatch_module_css_default.props,
											children: state.nodeDetail.props.map((prop) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: GodotWatch_module_css_default.propName,
												children: prop.name
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
												className: GodotWatch_module_css_default.propValue,
												children: prop.value
											})] }, prop.name))
										})] })
									})
								]
							})]
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: GodotWatch_module_css_default.hint,
					children: t("watchHint")
				})] })
			})]
		}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
			type: "button",
			className: `${GodotWatch_module_css_default.ball} ${ball.dragging ? GodotWatch_module_css_default.dragging : ""}`,
			style: {
				left: `${ball.position.x}px`,
				top: `${ball.position.y}px`
			},
			"aria-label": t("watchOpen"),
			...ball.handlers,
			onClick: () => {
				if (ball.consumeMoved()) return;
				toggle();
			},
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: GodotWatch_module_css_default.mark,
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					className: GodotWatch_module_css_default.ballLogo,
					src: godot_logo_svg_default,
					alt: "",
					draggable: false
				})
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: `${GodotWatch_module_css_default.status} ${dot} ${GodotWatch_module_css_default.badge}`,
				"aria-hidden": "true"
			})]
		})]
	});
}

//#endregion
//#region src/client/godot-card-controller.ts
/**
* Profile entry id of the Godot tool package. Spelled here rather than
* imported: a client package must not depend on a Host package, and the base
* bundle composes the tool under this id.
*/
const GODOT_NS = "tool-godot";
/**
* A single-choice field backed by a fixed value set (the format-backend
* select). The select can only produce listed values, but the spec still
* refuses anything else so a stray draft cannot reach the Host.
* @param field - field name inside the entry section.
* @param values - the accepted values, first being the format default.
* @returns the field's conversion spec.
*/
function settingsSelectField(field, values) {
	const fallback = values[0];
	return {
		field,
		format: (value) => values.includes(value) ? value : fallback,
		parse: (text) => values.includes(text) ? {
			kind: "set",
			value: text
		} : void 0
	};
}
/** Bridges the `tool-godot` entry's form onto the Godot card's staged form. */
var GodotCardController = class {
	form;
	store;
	/** @param scope - the shared configuration form of the composed Godot tool entry. */
	constructor(scope) {
		this.form = new __deepseek_ai_dsh_client_ui_primitives.SettingsFormModel(scope, [
			(0, __deepseek_ai_dsh_client_ui_primitives.settingsTextField)("executable"),
			(0, __deepseek_ai_dsh_client_ui_primitives.settingsTextField)("gdformatExecutable"),
			settingsSelectField("formatBackend", ["gdformat", "builtin"]),
			(0, __deepseek_ai_dsh_client_ui_primitives.settingsNumberField)("timeoutMs")
		]);
		this.store = this.form.bind(() => this.projection());
	}
	projection() {
		return {
			...this.form.shell(),
			executable: this.form.field("executable"),
			gdformatExecutable: this.form.field("gdformatExecutable"),
			formatBackend: this.form.field("formatBackend"),
			timeoutMs: this.form.field("timeoutMs")
		};
	}
	/**
	* Build the face the card's slot registration injects.
	* @returns the card's snapshot and its form actions.
	*/
	inject() {
		return {
			hooks: { godotCard: this.store },
			...this.form.actions()
		};
	}
	/** Release the form subscription. */
	dispose() {
		this.form.dispose();
	}
};

//#endregion
//#region src/client/locales.ts
/** Copy dictionaries for the Godot settings card. */
/** Simplified Chinese dictionary (verbatim v2.3 of ui-plugin-godot.js) and key source of truth. */
const zh = {
	name: "Godot",
	loading: "加载中…",
	readOnly: "只读",
	description: "告诉助手本机的 Godot 安装在哪里，助手在运行、检查、格式化 Godot 项目时会使用这里的配置。保存后，下一次操作会使用新配置。",
	executable: "Godot 编辑器路径",
	executableHint: "Godot 程序在本机的完整路径，例如 D:\\软件\\Godot\\Godot_v4.7.exe；也可以填已加入系统 PATH 的命令名。留空则使用默认命令 godot。",
	executablePlaceholder: "godot",
	gdformatExecutable: "gdformat 工具路径",
	gdformatExecutableHint: "可选。gdformat 是专门给 GDScript 代码排版的命令行工具，需单独安装；如果未安装，可把下方「代码格式化方式」切换为内置格式化器。",
	gdformatExecutablePlaceholder: "gdformat",
	formatBackend: "代码格式化方式",
	formatBackendHint: "选择整理 GDScript 代码缩进与排版时使用的工具。",
	formatBackendGdformat: "gdformat（效果更好，需单独安装）",
	formatBackendBuiltin: "内置格式化器（无需安装任何东西）",
	timeoutMs: "单次操作超时",
	timeoutMsHint: "助手每次执行 Godot 操作时最多等待的时间；超过后中止并报告（单位：毫秒，默认 60000，即 60 秒）。",
	timeoutMsPlaceholder: "60000",
	overridden: "已覆盖",
	reset: "重置",
	save: "保存",
	discard: "放弃",
	saveFailed: "本部署拒绝了这些值。你的修改仍保留，可以继续修正。",
	watchTitle: "Godot 沙盒",
	watchOpen: "打开 Godot 观察窗",
	watchClose: "收起观察窗",
	watchRunning: "运行中",
	watchLost: "已断开",
	watchLive: "实时画面",
	watchHint: "点击画面即可操作游戏。",
	watchIdle: "还没有运行中的 Godot 会话。让助手调用 godot_play 后，这里会出现实时画面。",
	watchError: "无法连接本机的 Godot 沙箱端点。请确认已挂载 tool-godot-ego，并已重启 dsh web。",
	watchTree: "场景树",
	watchTreeHide: "收起场景树",
	watchTreeShow: "展开场景树",
	watchPickNode: "选择场景树里的节点，这里显示它的属性。",
	watchDetail: "节点详情",
	watchResizeTree: "拖动调整场景树宽度",
	watchResizeDetail: "拖动调整节点详情高度",
	watchTreeEmpty: "还没有场景数据。",
	debugAttach: "附加",
	debugLaunch: "启动",
	debugAttachTarget: "运行中的游戏",
	debugMainScene: "主场景",
	debugBreakpoints: "个断点",
	debugStops: "停顿",
	debugDetached: "已分离",
	debugSceneTrees: "场景树",
	debugEdits: "编辑",
	debugExpanded: "展开对象",
	debugTruncated: "部分截断",
	debugFrames: "调用栈",
	debugVars: "变量",
	debugSceneTree: "场景树",
	debugExpansion: "展开对象",
	debugOutput: "输出与错误",
	debugPickNode: "选择树里的节点，这里显示它的身份与快照里捕获的属性。",
	debugNodeNotExpanded: "这次运行没有展开这个节点；用 expandNodes 或 nodePaths 重跑可捕获它的属性。",
	debugTreeCut: "这次运行的场景树没有随视图保存（视图超过体积上限被裁剪）。",
	debugTreeNoFrames: "这个暂停没有调用栈，因此没有场景树。",
	debugTreeNotCaptured: "这次运行没有为这个暂停取到场景树（节点或时间预算用尽，或场景树被关闭）。",
	debugTreeNodeCount: "个节点",
	debugTreeTruncated: "节点预算截断",
	debugNoExpansionHere: "这次运行的对象采样属于另一个暂停。",
	stateFrame: "帧",
	statePaused: "已暂停",
	stateChanged: "变更",
	stateNoTree: "这次读取没有带场景树（tree: false，或节点预算为 0）。",
	debugMoreRows: "…还有 {n} 行",
	debugInspect: "查看",
	debugRunning: "运行中",
	sceneTitle: "Godot 场景",
	sceneNodes: "个节点",
	sceneResources: "个外部资源",
	sceneInstance: "继承场景",
	sceneScript: "脚本",
	sceneUnique: "唯一名",
	sceneLine: "行",
	scenePickNode: "选择左侧节点查看它在文件里的属性。",
	sceneEmpty: "这个文件里没有场景节点。",
	sceneLoading: "正在读取场景…",
	sceneCollapse: "折叠",
	sceneExpand: "展开"
};
/** English dictionary checked against the Chinese key set. */
const en = {
	name: "Godot",
	loading: "Loading…",
	readOnly: "Read-only",
	description: "Tell the assistant where Godot is installed on this machine. It uses these settings to run, check, and format Godot projects. Your next operation uses the saved values.",
	executable: "Godot editor path",
	executableHint: "Full location of the Godot program, for example D:\\Software\\Godot\\Godot_v4.7.exe; or a command name already on the system PATH. Leave blank to use the default command godot.",
	executablePlaceholder: "godot",
	gdformatExecutable: "gdformat tool path",
	gdformatExecutableHint: "Optional. gdformat is a command-line tool for formatting GDScript code. Install it separately. If you do not have it, switch Code format mode below to Built-in formatter.",
	gdformatExecutablePlaceholder: "gdformat",
	formatBackend: "Code format mode",
	formatBackendHint: "Choose the tool that formats GDScript indentation and layout.",
	formatBackendGdformat: "gdformat (better results, requires separate install)",
	formatBackendBuiltin: "Built-in formatter (nothing to install)",
	timeoutMs: "Per-operation timeout",
	timeoutMsHint: "How long the assistant waits for each Godot-related operation before aborting and reporting (in milliseconds, default 60000 = 60 seconds).",
	timeoutMsPlaceholder: "60000",
	overridden: "Overridden",
	reset: "Reset",
	save: "Save",
	discard: "Discard",
	saveFailed: "The deployment rejected these values. Your edits are still here, so you can correct them.",
	watchTitle: "Godot sandbox",
	watchOpen: "Open the Godot watch panel",
	watchClose: "Close the watch panel",
	watchRunning: "Running",
	watchLost: "Disconnected",
	watchLive: "Live frame",
	watchHint: "Click the frame to operate the game.",
	watchIdle: "No Godot session is running. Ask the assistant to call godot_play, and the live frame appears here.",
	watchError: "Cannot reach the local Godot sandbox endpoint. Make sure tool-godot-ego is mounted and that you restarted dsh web.",
	watchTree: "Scene tree",
	watchTreeHide: "Hide the scene tree",
	watchTreeShow: "Show the scene tree",
	watchPickNode: "Pick a node in the tree to see its properties here.",
	watchDetail: "Node details",
	watchResizeTree: "Drag to resize the scene tree",
	watchResizeDetail: "Drag to resize the node details",
	watchTreeEmpty: "No scene data yet.",
	debugAttach: "attach",
	debugLaunch: "launch",
	debugAttachTarget: "running game",
	debugMainScene: "main scene",
	debugBreakpoints: "breakpoints",
	debugStops: "stops",
	debugDetached: "detached",
	debugSceneTrees: "scene trees",
	debugEdits: "edits",
	debugExpanded: "expanded",
	debugTruncated: "partly truncated",
	debugFrames: "Call stack",
	debugVars: "Variables",
	debugSceneTree: "Scene tree",
	debugExpansion: "Expanded objects",
	debugOutput: "Output and errors",
	debugPickNode: "Pick a node in the tree to see its identity and the properties the snapshot captured.",
	debugNodeNotExpanded: "This run did not expand that node; re-run with expandNodes or nodePaths to capture it.",
	debugTreeCut: "The scene tree was not persisted with this view (it exceeded the size budget).",
	debugTreeNoFrames: "This pause had no call stack, so the run took no scene tree.",
	debugTreeNotCaptured: "This run took no scene tree at this pause (node or time budget spent, or scene trees disabled).",
	debugTreeNodeCount: "nodes",
	debugTreeTruncated: "node budget reached",
	debugNoExpansionHere: "This run's object sample belongs to another pause.",
	stateFrame: "frame",
	statePaused: "paused",
	stateChanged: "changed",
	stateNoTree: "This read carried no scene tree (tree: false, or the node budget is 0).",
	debugMoreRows: "… {n} more rows",
	debugInspect: "Inspect",
	debugRunning: "running",
	sceneTitle: "Godot scene",
	sceneNodes: "nodes",
	sceneResources: "external resources",
	sceneInstance: "inherited scene",
	sceneScript: "script",
	sceneUnique: "unique name",
	sceneLine: "line",
	scenePickNode: "Pick a node on the left to see its properties in the file.",
	sceneEmpty: "This file declares no scene nodes.",
	sceneLoading: "Reading the scene…",
	sceneCollapse: "Collapse",
	sceneExpand: "Expand"
};

//#endregion
//#region src/client/index.ts
/** Dictionary namespace owned by this plugin. */
const NS = "settings.godot";
/** Dictionary namespace of the debug tool card. */
const DEBUG_NS = "godot.debug";
/** Dictionary namespace of the scene document body. */
const SCENE_NS = "godot.scene";
/** Dictionary namespace of the state card. */
const STATE_NS = "godot.state";
/** Implementation id of the `.tscn` document body; also its slot key. */
const SCENE_BODY_ID = "@deepseek-ai/dsh-ui-godot/scene";
/** Services required by the Settings registration. */
const inject = [
	"slots",
	"locale",
	"configForms",
	"documentPreviews"
];
/** The installable bundle whose page carries the Godot settings card. */
const GODOT_BUNDLE = "@deepseek-ai/dsh-godot-bundle";
function apply(ctx) {
	ctx.effect(() => ctx.locale.register(NS, {
		zh,
		en
	}), "ui-godot: dictionaries");
	ctx.effect(() => ctx.locale.register(WATCH_NS, {
		zh,
		en
	}), "ui-godot: watch dictionary");
	ctx.effect(() => ctx.locale.register(DEBUG_NS, {
		zh,
		en
	}), "ui-godot: debug dictionary");
	ctx.effect(() => ctx.locale.register(STATE_NS, {
		zh,
		en
	}), "ui-godot: state dictionary");
	ctx.effect(() => ctx.locale.register(SCENE_NS, {
		zh,
		en
	}), "ui-godot: scene dictionary");
	const sceneLabel = ctx.locale.bind(SCENE_NS);
	ctx.effect(() => ctx.documentPreviews.register({
		id: SCENE_BODY_ID,
		extensions: ["tscn"],
		priority: "extension",
		title: () => sceneLabel("sceneTitle"),
		loading: "text-pages",
		wrap: false
	}), "ui-godot: scene metadata");
	ctx.effect(() => ctx.slots.inject("sidebar.right.tab.document", () => ctx.slots.register({
		name: "sidebar.right.tab.document",
		key: SCENE_BODY_ID,
		locale: SCENE_NS
	}, SceneBody)), "ui-godot: scene body");
	const godot = new GodotCardController(ctx.configForms.get(GODOT_NS));
	ctx.effect(() => () => {
		godot.dispose();
	}, "ui-godot: form subscription");
	ctx.effect(() => ctx.configForms.whileServed([GODOT_NS], () => ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
		name: "plugins.bundle.config",
		key: GODOT_BUNDLE,
		locale: NS,
		inject: () => godot.inject()
	}, GodotCard))), "ui-godot: page");
	ctx.effect(() => ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
		name: "tool.call.toolview",
		key: "godot_debug",
		locale: DEBUG_NS
	}, DebugCard)), "ui-godot: debug card");
	ctx.effect(() => ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
		name: "tool.call.toolview",
		key: "godot_state",
		locale: STATE_NS
	}, StateCard)), "ui-godot: state card");
	const watch = new GodotWatchController();
	ctx.effect(() => ctx.slots.inject("shell.overlay", () => {
		let dispose;
		try {
			dispose = ctx.slots.register({
				name: "shell.overlay",
				id: "godot.watch",
				order: 40,
				locale: WATCH_NS,
				inject: () => watch.inject()
			}, GodotWatch);
			watch.start();
			return () => {
				watch.dispose();
				dispose?.();
			};
		} catch (error) {
			ctx.logger.warn(error);
			watch.dispose();
			dispose?.();
			return () => {};
		}
	}), "ui-godot: watch");
}

//#endregion
exports.DEBUG_NS = DEBUG_NS;
exports.GODOT_BUNDLE = GODOT_BUNDLE;
exports.SCENE_BODY_ID = SCENE_BODY_ID;
exports.SCENE_NS = SCENE_NS;
exports.STATE_NS = STATE_NS;
exports.apply = apply;
exports.inject = inject;
return module.exports; } });