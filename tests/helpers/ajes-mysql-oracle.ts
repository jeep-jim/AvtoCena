/** SQLite TEXT affinity compares numeric literals as text, unlike MySQL:
 * https://dev.mysql.com/doc/refman/8.4/en/type-conversion.html
 * Adapt only PW's numeric operand in the offline SQL oracle; wire SQL is never changed. Expected
 * membership must still come from the actual admission/filter functions.
 */
export function ajesMysqlOracleSql(sql:string):string {
 return sql.replace(/\bpw(?=\s*(?:>=|<=|>|<)\s*\d)/g,'CAST(pw AS REAL)');
}
