module.exports = async (req, res) => {
  req.url = "/api/voucher?action=commit";
  return require("./../voucher")(req, res);
};
