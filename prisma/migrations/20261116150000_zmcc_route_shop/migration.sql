-- Extra routes a shop is also listed on. zmcc_shop.route_id stays the home route.
CREATE TABLE "zmcc_route_shop" (
    "id" BIGSERIAL NOT NULL,
    "route_id" BIGINT NOT NULL,
    "shop_id" BIGINT NOT NULL,
    "created_by" BIGINT,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT now(),
    CONSTRAINT "zmcc_route_shop_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "zmcc_route_shop_route_id_shop_id_key" ON "zmcc_route_shop"("route_id", "shop_id");
CREATE INDEX "zmcc_route_shop_shop_id_idx" ON "zmcc_route_shop"("shop_id");

ALTER TABLE "zmcc_route_shop" ADD CONSTRAINT "zmcc_route_shop_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "zmcc_route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zmcc_route_shop" ADD CONSTRAINT "zmcc_route_shop_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "zmcc_shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
