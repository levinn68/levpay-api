module.exports = async (req, res) => {
  req.url = "/api/voucher?action=upsert";
  return require("./../../voucher")(req, res);
};
