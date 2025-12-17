module.exports = async (req, res) => {
  req.url = "/api/voucher?action=monthly";
  return require("./../../voucher")(req, res);
};
