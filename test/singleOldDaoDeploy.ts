process.env.TEST = "true";
const deploy = require("./localOldDaoDeploy").deploy;
deploy("dapptest", true);
