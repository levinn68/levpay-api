module.exports = async (req, res) => {
  req.url = "/api/voucher?action=disable";
  return require("./../../voucher")(req, res);
};
